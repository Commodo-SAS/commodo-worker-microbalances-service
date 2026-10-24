import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { BalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { BaseTransactionHandler } from './base-transaction.handler';

/**
 * Cashback, commission, tax, purchase returns, refunds and stamp exchange: creates one bag for the receiver and
 * uses it to cover the receiver debt bags. Ported unchanged from the legacy transaction balance handler.
 */
export class CashbackTransactionHandler extends BaseTransactionHandler {
    /**
     * Creates the receiver bag and uses it to cover the receiver debt bags.
     * @throws MicrobalanceRuleError when the receiver wallet is missing.
     */
    async execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const { amount, transactionId, createUserId, walletReceiverId } = movement;

        // Step 1: the receiver wallet is mandatory for cashback-type movements.
        this.validateWallet(walletReceiverId, 'receptora');

        // Step 2: the amount becomes a new available bag for the receiver.
        const newWalletBalance = await this.createWalletBalance(unit, transactionId, walletReceiverId, amount, createUserId);

        // Step 3: the new bag first pays off the receiver debt, oldest debt first.
        await this.coverNegativeBalances(unit, {
            walletId: walletReceiverId,
            amount,
            newWalletBalanceId: newWalletBalance.id,
            createUserId,
            transactionId,
        });
    }
}
