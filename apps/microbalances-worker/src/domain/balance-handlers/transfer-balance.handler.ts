import { MicrobalanceRuleError } from '../errors';
import { MicrobalanceMovement } from '../movement';
import { BalanceUnit } from '../ports/balance-unit';
import { TransactionType, WalletBalanceStatus } from '../transaction-type';
import { BaseBalanceHandler } from './base-balance.handler';

export class TransferBalanceHandler extends BaseBalanceHandler {
    async execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const { amount, transactionId, createUserId, walletTransferId, walletReceiverId, transactionType, allowSenderDebt } = movement;

        this.validateWallet(walletTransferId, 'emisora');

        const isCreditToCreditLine = transactionType === TransactionType.CREDIT && !!walletTransferId && !walletReceiverId;

        if (!isCreditToCreditLine) {
            this.validateWallet(walletReceiverId, 'receptora');
        }

        const availableBalances = await unit.walletBalances.findAllAvailableByWalletId(walletTransferId);

        let remainingAmount = amount;

        for (const balance of availableBalances) {
            if (remainingAmount <= 0) break;

            if (balance.availableAmount <= 0) continue;

            const amountToUse = Math.min(remainingAmount, balance.availableAmount);
            const newAvailableAmount = balance.availableAmount - amountToUse;

            await unit.walletBalances.update(balance.id, {
                availableAmount: newAvailableAmount,
                updatedBy: createUserId,
                balanceStatus: this.resolveBalanceStatus(newAvailableAmount, balance.balanceStatus),
            });

            await unit.references.create({ transactionId, walletBalanceId: balance.id, amountUsed: amountToUse, createdBy: createUserId });

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

            remainingAmount -= amountToUse;
        }

        if (remainingAmount > 0) {
            if (!allowSenderDebt) {
                throw new MicrobalanceRuleError(
                    'insufficient_balance',
                    `Saldo insuficiente en las bolsas disponibles. Faltan ${remainingAmount} para completar la transferencia`,
                );
            }

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
}
