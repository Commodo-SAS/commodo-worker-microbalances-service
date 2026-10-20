import { MicrobalanceMovement } from '../movement';
import { BalanceUnit } from '../ports/balance-unit';
import { BaseBalanceHandler } from './base-balance.handler';

export class CashbackBalanceHandler extends BaseBalanceHandler {
    async execute(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const { amount, transactionId, createUserId, walletReceiverId } = movement;

        this.validateWallet(walletReceiverId, 'receptora');

        const newWalletBalance = await this.createWalletBalance(unit, transactionId, walletReceiverId, amount, createUserId);

        await this.coverNegativeBalances(unit, {
            walletId: walletReceiverId,
            amount,
            newWalletBalanceId: newWalletBalance.id,
            createUserId,
            transactionId,
        });
    }
}
