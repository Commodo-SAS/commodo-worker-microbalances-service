import { MicrobalanceRuleError } from '../../../../domain/errors/microbalance.errors';
import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { BalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { WalletBalanceRecord } from '../../../../domain/ports/secondary/wallet-balance.port';
import { TransactionType, WalletBalanceStatus } from '../../../../domain/enums/transaction-type.enum';
import { BaseTransactionHandler } from './base-transaction.handler';

/** Sender bags read per query; large enough for the usual case in one round trip and small enough to bound memory. */
const SPENDABLE_PAGE_SIZE = 200;

/**
 * Transfers, redemptions, purchases, surcharges, credits and bonuses: consumes the sender bags oldest first and
 * creates a receiver bag per consumed bag. Any shortfall becomes a sender debt bag only when the movement allows
 * sender debt; otherwise it is rejected. Ported from the legacy transfer handler; the only changes are that sender
 * bags are read by pages and that amounts are rounded to the column scale.
 */
export class TransferTransactionHandler extends BaseTransactionHandler {
    /**
     * Consumes the sender bags and credits the receiver, creating a debt bag for any shortfall when sender debt is allowed.
     * @throws MicrobalanceRuleError when a wallet is missing or the balance is insufficient and sender debt is not allowed.
     */
    async execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const { amount, transactionId, createUserId, walletTransferId, walletReceiverId, transactionType, allowSenderDebt } = movement;

        // Step 1: validate the wallets the movement needs.
        this.validateWallet(walletTransferId, 'emisora');

        // A credit funded from a wallet that lands on a credit line has no receiver wallet.
        const isCreditToCreditLine = transactionType === TransactionType.CREDIT && !!walletTransferId && !walletReceiverId;

        if (!isCreditToCreditLine) {
            this.validateWallet(walletReceiverId, 'receptora');
        }

        // Step 2: draw from the sender bags oldest first (FIFO), one page at a time so a wallet with many bags is never
        // loaded whole. Consumed bags leave the AVAILABLE set, so asking again returns the next oldest bags; the query
        // already excludes debt bags and the bags this movement creates (a self transfer must not spend its own bags).
        let remainingAmount = amount;
        let page = await unit.walletBalances.findSpendableByWalletId(walletTransferId, SPENDABLE_PAGE_SIZE, transactionId);

        while (page.length > 0 && remainingAmount > 0) {
            const firstBagId = page[0].id;
            for (const balance of page) {
                if (remainingAmount <= 0) break;
                remainingAmount = await this.consumeBalance(unit, balance, remainingAmount, movement, isCreditToCreditLine);
            }
            if (remainingAmount <= 0) break;
            // The amount is not covered yet: read the next page, unless the same bag came back (defensive stop).
            page = await unit.walletBalances.findSpendableByWalletId(walletTransferId, SPENDABLE_PAGE_SIZE, transactionId);
            if (page[0]?.id === firstBagId) break;
        }

        // Step 3: the sender bags did not cover the whole amount.
        if (remainingAmount > 0) {
            // Without sender debt the shortfall is an error and the transaction rolls back.
            if (!allowSenderDebt) {
                throw new MicrobalanceRuleError(
                    'insufficient_balance',
                    `Saldo insuficiente en las bolsas disponibles. Faltan ${remainingAmount} para completar la transferencia`,
                );
            }

            // With sender debt the shortfall becomes a negative bag on the sender wallet.
            const debtBag = await unit.walletBalances.create({
                transactionId,
                walletId: walletTransferId,
                originalAmount: -remainingAmount,
                availableAmount: -remainingAmount,
                balanceStatus: WalletBalanceStatus.AVAILABLE,
                expirationDate: this.getDefaultExpirationDate(),
                createdBy: createUserId,
            });

            await unit.references.create({ transactionId, walletBalanceId: debtBag.id, amountUsed: remainingAmount, createdBy: createUserId });

            // The receiver still gets the full amount, so the shortfall is mirrored as a receiver bag too.
            if (!isCreditToCreditLine && walletReceiverId) {
                const receiverBag = await this.createWalletBalance(unit, transactionId, walletReceiverId, remainingAmount, createUserId);

                await this.coverNegativeBalances(unit, {
                    walletId: walletReceiverId,
                    amount: remainingAmount,
                    newWalletBalanceId: receiverBag.id,
                    createUserId,
                    transactionId,
                });
            }
        }
    }

    /**
     * Draws as much of one sender bag as the movement still needs, records the reference and mirrors the amount as a
     * receiver bag that also covers the receiver debt.
     * @returns The amount the movement still has to cover after this bag.
     */
    private async consumeBalance(
        unit: BalanceUnit,
        balance: WalletBalanceRecord,
        remainingAmount: number,
        movement: MicrobalanceMovement,
        isCreditToCreditLine: boolean,
    ): Promise<number> {
        const { transactionId, createUserId, walletReceiverId } = movement;

        // Use as much of this bag as the movement still needs.
        const amountToUse = Math.min(remainingAmount, balance.availableAmount);
        const newAvailableAmount = this.subtract(balance.availableAmount, amountToUse);

        // Reduce the sender bag; it becomes USED once it is exhausted.
        await unit.walletBalances.update(balance.id, {
            availableAmount: newAvailableAmount,
            updatedBy: createUserId,
            balanceStatus: this.resolveBalanceStatus(newAvailableAmount, balance.balanceStatus),
        });

        // Record which sender bag funded this movement.
        await unit.references.create({ transactionId, walletBalanceId: balance.id, amountUsed: amountToUse, createdBy: createUserId });

        // Mirror the consumed amount as a receiver bag and let it cover the receiver debt.
        if (!isCreditToCreditLine && walletReceiverId) {
            const newWalletBalance = await this.createWalletBalance(unit, transactionId, walletReceiverId, amountToUse, createUserId);

            await this.coverNegativeBalances(unit, {
                walletId: walletReceiverId,
                amount: amountToUse,
                newWalletBalanceId: newWalletBalance.id,
                createUserId,
                transactionId,
            });
        }

        return this.subtract(remainingAmount, amountToUse);
    }
}
