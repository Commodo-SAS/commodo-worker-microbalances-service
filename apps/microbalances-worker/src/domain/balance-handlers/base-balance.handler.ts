import { MicrobalanceRuleError } from '../errors';
import { MicrobalanceMovement } from '../movement';
import { BalanceUnit } from '../ports/balance-unit';
import { WalletBalanceStatus } from '../transaction-type';

export interface BalanceHandler {
    execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void>;
}

export abstract class BaseBalanceHandler implements BalanceHandler {
    abstract execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void>;

    protected validateWallet(walletId: number | undefined, type: 'emisora' | 'receptora'): void {
        if (!walletId) {
            throw new MicrobalanceRuleError('wallet_missing', `No se proporcionó la billetera ${type} para procesar la transacción`);
        }
    }

    protected resolveBalanceStatus(availableAmount: number, originalStatus?: WalletBalanceStatus): WalletBalanceStatus {
        if (availableAmount === 0) {
            return WalletBalanceStatus.USED;
        }
        return originalStatus || WalletBalanceStatus.AVAILABLE;
    }

    protected createWalletBalance(unit: BalanceUnit, transactionId: number, walletId: number, amount: number, createdBy: number) {
        return unit.walletBalances.create({
            transactionId,
            walletId,
            originalAmount: amount,
            availableAmount: amount,
            expirationDate: this.getDefaultExpirationDate(),
            createdBy,
        });
    }

    protected getDefaultExpirationDate(): Date {
        const expirationDate = new Date();
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
        return expirationDate;
    }

    protected async coverNegativeBalances(
        unit: BalanceUnit,
        {
            walletId,
            amount,
            newWalletBalanceId,
            createUserId,
            transactionId,
        }: { walletId: number; amount: number; newWalletBalanceId: number; createUserId: number; transactionId: number },
    ): Promise<number> {
        let remainingAmount = amount;
        const negativeBalances = await unit.walletBalances.findAllNegativeByWalletId(walletId);

        for (const negativeBag of negativeBalances) {
            if (remainingAmount <= 0) break;

            const amountToCover = Math.min(remainingAmount, Math.abs(negativeBag.availableAmount));
            const updatedNegativeAvailable = negativeBag.availableAmount + amountToCover;
            const updatedNewBagAvailable = remainingAmount - amountToCover;

            await unit.walletBalances.update(negativeBag.id, {
                availableAmount: updatedNegativeAvailable,
                updatedBy: createUserId,
                balanceStatus: this.resolveBalanceStatus(updatedNegativeAvailable, negativeBag.balanceStatus),
            });

            await unit.walletBalances.update(newWalletBalanceId, {
                availableAmount: updatedNewBagAvailable,
                updatedBy: createUserId,
                balanceStatus: this.resolveBalanceStatus(updatedNewBagAvailable),
            });

            await unit.references.create({
                transactionId,
                walletBalanceId: negativeBag.id,
                amountUsed: amountToCover,
                createdBy: createUserId,
            });

            remainingAmount = updatedNewBagAvailable;
        }

        return remainingAmount;
    }
}
