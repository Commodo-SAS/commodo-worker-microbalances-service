import { MicrobalanceRuleError } from '../../../../domain/errors/microbalance.errors';
import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { BalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { WalletBalanceStatus } from '../../../../domain/enums/transaction-type.enum';

/** Balance rule for one family of transaction types. */
export interface TransactionHandler {
    /**
     * Applies the balance rule of one movement through the transaction-bound unit.
     * @param movement - Movement to apply.
     * @param unit - Persistence bound to the active database transaction.
     * @throws MicrobalanceRuleError when the rule rejects the movement.
     */
    execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void>;
}

/**
 * Shared building blocks of the balance rules: wallet validation, bag creation, expiration and debt coverage.
 * Ported from the legacy base handler without functional changes.
 */
export abstract class BaseTransactionHandler implements TransactionHandler {
    /** Applies the rule of the concrete handler; see TransactionHandler.execute. */
    abstract execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void>;

    /**
     * Rejects a movement whose required wallet was not provided.
     * @param walletId - Wallet identity received in the movement.
     * @param type - Role of the wallet, used only in the error message.
     * @throws MicrobalanceRuleError when the wallet is missing.
     */
    protected validateWallet(walletId: number | undefined, type: 'emisora' | 'receptora'): void {
        if (!walletId) {
            throw new MicrobalanceRuleError('wallet_missing', `No se proporcionó la billetera ${type} para procesar la transacción`);
        }
    }

    /** A bag that reaches zero becomes USED; otherwise it keeps its previous status. */
    protected resolveBalanceStatus(availableAmount: number, originalStatus?: WalletBalanceStatus): WalletBalanceStatus {
        if (availableAmount === 0) {
            return WalletBalanceStatus.USED;
        }
        return originalStatus || WalletBalanceStatus.AVAILABLE;
    }

    /**
     * Creates an AVAILABLE bag with the default one-year expiration.
     * @returns The persisted bag, whose id is needed to cover debt with it.
     */
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

    /** Bags expire one year after their creation, as in the legacy handler. */
    protected getDefaultExpirationDate(): Date {
        const expirationDate = new Date();
        expirationDate.setFullYear(expirationDate.getFullYear() + 1);
        return expirationDate;
    }

    /**
     * Offsets the receiver debt bags with the freshly created bag, oldest debt first.
     * @returns The amount left in the new bag after covering debt.
     */
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
        // Debt bags are covered oldest first; each pass moves value from the new bag into one debt bag.
        let remainingAmount = amount;
        const negativeBalances = await unit.walletBalances.findAllNegativeByWalletId(walletId);

        for (const negativeBag of negativeBalances) {
            if (remainingAmount <= 0) break;

            // Cover as much of this debt as the new bag still holds.
            const amountToCover = Math.min(remainingAmount, Math.abs(negativeBag.availableAmount));
            const updatedNegativeAvailable = negativeBag.availableAmount + amountToCover;
            const updatedNewBagAvailable = remainingAmount - amountToCover;

            // Raise the debt bag towards zero; it becomes USED once it is fully covered.
            await unit.walletBalances.update(negativeBag.id, {
                availableAmount: updatedNegativeAvailable,
                updatedBy: createUserId,
                balanceStatus: this.resolveBalanceStatus(updatedNegativeAvailable, negativeBag.balanceStatus),
            });

            // Shrink the new bag by the amount it used to cover the debt.
            await unit.walletBalances.update(newWalletBalanceId, {
                availableAmount: updatedNewBagAvailable,
                updatedBy: createUserId,
                balanceStatus: this.resolveBalanceStatus(updatedNewBagAvailable),
            });

            // Record which debt bag this movement covered.
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
