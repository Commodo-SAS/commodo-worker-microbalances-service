import { MicrobalanceRuleError } from '../../../../domain/errors/microbalance.errors';
import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { BalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { WalletBalanceRecord } from '../../../../domain/ports/secondary/wallet-balance.port';
import { WalletBalanceStatus } from '../../../../domain/enums/transaction-type.enum';
import { BaseTransactionHandler } from './base-transaction.handler';

/**
 * Reversal of a previous movement: draws the original movement bags first (marking them REVERSED when exhausted),
 * then the remaining positive bags. A remainder deepens an existing debt bag or opens a new one. Ported unchanged
 * from the legacy reverse handler.
 */
export class ReverseTransactionHandler extends BaseTransactionHandler {
    /**
     * Reverses a previous movement and books any uncovered remainder as sender debt.
     * @throws MicrobalanceRuleError when the reversed transaction or a required wallet is missing.
     */
    async execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const { reverseParentTransactionId, createUserId, walletTransferId, walletReceiverId, hasCreditLine, amount, transactionId } = movement;

        // Step 1: a reversal needs the reversed transaction and its wallets.
        this.validateParams(reverseParentTransactionId, walletTransferId, walletReceiverId, hasCreditLine);

        // Step 2: collect the bags to draw from: the original movement bags first, then the other positive ones.
        const { balancesToProcess, originalBalanceIds, negativeBalances } = await this.prepareBalances(
            unit,
            reverseParentTransactionId,
            walletTransferId,
        );

        // Step 3: draw the reversed amount from those bags.
        const remainingAmount = await this.processPositiveBalances(
            unit,
            balancesToProcess,
            originalBalanceIds,
            amount,
            transactionId,
            createUserId,
            walletReceiverId,
            hasCreditLine,
        );

        // Step 4: whatever the bags could not cover is booked as sender debt.
        if (remainingAmount > 0) {
            await this.handleRemainingReverseAmount(
                unit,
                remainingAmount,
                negativeBalances,
                transactionId,
                createUserId,
                walletTransferId,
                walletReceiverId,
                hasCreditLine,
            );
        }
    }

    /**
     * Checks the parameters a reversal cannot work without.
     * @throws MicrobalanceRuleError when the reversed transaction or a required wallet is missing.
     */
    private validateParams(
        reverseParentTransactionId: number | undefined,
        walletTransferId: number | undefined,
        walletReceiverId: number | undefined,
        hasCreditLine: boolean,
    ): void {
        if (!reverseParentTransactionId) {
            throw new MicrobalanceRuleError('reverse_parent_missing', 'No se proporcionó el ID de la transacción a revertir.');
        }

        this.validateWallet(walletTransferId, 'emisora');
        if (!hasCreditLine) {
            this.validateWallet(walletReceiverId, 'receptora');
        }
    }

    /**
     * Splits the sender bags into the ones to draw from and the debt bags.
     * @returns The bags to process in order, the ids of the original movement bags and the debt bags.
     */
    private async prepareBalances(
        unit: BalanceUnit,
        reverseParentTransactionId: number,
        walletId: number,
    ): Promise<{ balancesToProcess: WalletBalanceRecord[]; originalBalanceIds: Set<number>; negativeBalances: WalletBalanceRecord[] }> {
        const originalTransactionBalances = await unit.walletBalances.findAllByTransactionIdAndWalletId(reverseParentTransactionId, walletId);

        // Only bags of the reversed movement that still hold value can be reversed.
        const originalAvailableBalances = originalTransactionBalances.filter(
            (b) => b.balanceStatus === WalletBalanceStatus.AVAILABLE && b.availableAmount > 0,
        );

        const allBalances = await unit.walletBalances.findAllAvailableByWalletId(walletId);
        const otherBalances = allBalances.filter((b) => !originalAvailableBalances.some((ob) => ob.id === b.id));

        const positiveBalances = otherBalances.filter((b) => b.availableAmount > 0);
        const negativeBalances = allBalances.filter((b) => b.availableAmount < 0);

        // Original bags are drawn before any other positive bag.
        const balancesToProcess = [...originalAvailableBalances, ...positiveBalances];
        const originalBalanceIds = new Set(originalAvailableBalances.map((b) => b.id));

        return { balancesToProcess, originalBalanceIds, negativeBalances };
    }

    /**
     * Draws the reversed amount from the positive bags, updating each bag and crediting the receiver.
     * @returns The amount the positive bags could not cover.
     */
    private async processPositiveBalances(
        unit: BalanceUnit,
        balancesToProcess: WalletBalanceRecord[],
        originalBalanceIds: Set<number>,
        amount: number,
        transactionId: number,
        createUserId: number,
        walletReceiverId: number | undefined,
        hasCreditLine: boolean,
    ): Promise<number> {
        let remainingAmount = amount;

        for (const balance of balancesToProcess) {
            if (remainingAmount <= 0) break;

            const amountToUse = Math.min(remainingAmount, balance.availableAmount);
            const newAvailableAmount = balance.availableAmount - amountToUse;
            // Original bags that are fully drawn become REVERSED instead of USED.
            const isOriginalTransactionBalance = originalBalanceIds.has(balance.id);
            const newStatus = this.determineReverseStatus(balance, amountToUse, newAvailableAmount, isOriginalTransactionBalance);

            await unit.walletBalances.update(balance.id, {
                availableAmount: newAvailableAmount,
                updatedBy: createUserId,
                balanceStatus: newStatus,
            });

            await unit.references.create({ transactionId, walletBalanceId: balance.id, amountUsed: amountToUse, createdBy: createUserId });

            // A credit line receives the reversal without a receiver bag.
            if (!hasCreditLine) {
                await this.createWalletBalance(unit, transactionId, walletReceiverId, amountToUse, createUserId);
            }

            remainingAmount -= amountToUse;
        }

        return remainingAmount;
    }

    /**
     * Chooses the status of a drawn bag: REVERSED for an exhausted original bag, USED for any other exhausted bag.
     * @returns The status to persist.
     */
    private determineReverseStatus(
        balance: WalletBalanceRecord,
        amountToUse: number,
        newAvailableAmount: number,
        isOriginalTransactionBalance: boolean,
    ): WalletBalanceStatus {
        if (isOriginalTransactionBalance && amountToUse === balance.availableAmount) {
            return WalletBalanceStatus.REVERSED;
        }

        if (newAvailableAmount === 0) {
            return WalletBalanceStatus.USED;
        }

        return WalletBalanceStatus.AVAILABLE;
    }

    /** Books the amount the positive bags could not cover as sender debt and credits the receiver with it. */
    private async handleRemainingReverseAmount(
        unit: BalanceUnit,
        remainingAmount: number,
        negativeBalances: WalletBalanceRecord[],
        transactionId: number,
        createUserId: number,
        senderWalletId: number,
        receiverWalletId: number | undefined,
        hasCreditLine: boolean,
    ): Promise<void> {
        // Deepen the oldest debt bag if there is one; otherwise open a new debt bag.
        const negativeBag = negativeBalances[0];

        if (negativeBag) {
            const updatedNegativeAvailable = negativeBag.availableAmount - remainingAmount;

            await unit.walletBalances.update(negativeBag.id, {
                availableAmount: updatedNegativeAvailable,
                updatedBy: createUserId,
                balanceStatus: negativeBag.balanceStatus,
            });

            await unit.references.create({ transactionId, walletBalanceId: negativeBag.id, amountUsed: remainingAmount, createdBy: createUserId });
        } else {
            const newNegativeBag = await unit.walletBalances.create({
                transactionId,
                walletId: senderWalletId,
                originalAmount: -remainingAmount,
                availableAmount: -remainingAmount,
                expirationDate: this.getDefaultExpirationDate(),
                createdBy: createUserId,
            });

            await unit.references.create({ transactionId, walletBalanceId: newNegativeBag.id, amountUsed: remainingAmount, createdBy: createUserId });
        }

        if (!hasCreditLine && receiverWalletId) {
            await this.createWalletBalance(unit, transactionId, receiverWalletId, remainingAmount, createUserId);
        }
    }
}
