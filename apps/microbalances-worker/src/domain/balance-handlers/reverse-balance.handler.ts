import { MicrobalanceRuleError } from '../errors';
import { MicrobalanceMovement } from '../movement';
import { BalanceUnit, WalletBalanceRecord } from '../ports/balance-unit';
import { WalletBalanceStatus } from '../transaction-type';
import { BaseBalanceHandler } from './base-balance.handler';

export class ReverseBalanceHandler extends BaseBalanceHandler {
    async execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const { reverseParentTransactionId, createUserId, walletTransferId, walletReceiverId, hasCreditLine, amount, transactionId } = movement;

        this.validateParams(reverseParentTransactionId, walletTransferId, walletReceiverId, hasCreditLine);

        const { balancesToProcess, originalBalanceIds, negativeBalances } = await this.prepareBalances(
            unit,
            reverseParentTransactionId,
            walletTransferId,
        );

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

    private async prepareBalances(
        unit: BalanceUnit,
        reverseParentTransactionId: number,
        walletId: number,
    ): Promise<{ balancesToProcess: WalletBalanceRecord[]; originalBalanceIds: Set<number>; negativeBalances: WalletBalanceRecord[] }> {
        const originalTransactionBalances = await unit.walletBalances.findAllByTransactionIdAndWalletId(reverseParentTransactionId, walletId);

        const originalAvailableBalances = originalTransactionBalances.filter(
            (b) => b.balanceStatus === WalletBalanceStatus.AVAILABLE && b.availableAmount > 0,
        );

        const allBalances = await unit.walletBalances.findAllAvailableByWalletId(walletId);
        const otherBalances = allBalances.filter((b) => !originalAvailableBalances.some((ob) => ob.id === b.id));

        const positiveBalances = otherBalances.filter((b) => b.availableAmount > 0);
        const negativeBalances = allBalances.filter((b) => b.availableAmount < 0);

        const balancesToProcess = [...originalAvailableBalances, ...positiveBalances];
        const originalBalanceIds = new Set(originalAvailableBalances.map((b) => b.id));

        return { balancesToProcess, originalBalanceIds, negativeBalances };
    }

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
            const isOriginalTransactionBalance = originalBalanceIds.has(balance.id);
            const newStatus = this.determineReverseStatus(balance, amountToUse, newAvailableAmount, isOriginalTransactionBalance);

            await unit.walletBalances.update(balance.id, {
                availableAmount: newAvailableAmount,
                updatedBy: createUserId,
                balanceStatus: newStatus,
            });

            await unit.references.create({ transactionId, walletBalanceId: balance.id, amountUsed: amountToUse, createdBy: createUserId });

            if (!hasCreditLine) {
                await this.createWalletBalance(unit, transactionId, walletReceiverId, amountToUse, createUserId);
            }

            remainingAmount -= amountToUse;
        }

        return remainingAmount;
    }

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
