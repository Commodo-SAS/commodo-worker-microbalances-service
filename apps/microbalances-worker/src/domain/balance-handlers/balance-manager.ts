import { MicrobalanceRuleError } from '../errors';
import { MicrobalanceMovement } from '../movement';
import { BalanceUnit } from '../ports/balance-unit';
import { TransactionType } from '../transaction-type';
import { BalanceHandler } from './base-balance.handler';
import { CashbackBalanceHandler } from './cashback-balance.handler';
import { ReverseBalanceHandler } from './reverse-balance.handler';
import { TransferBalanceHandler } from './transfer-balance.handler';

export class BalanceManager {
    private readonly handlers: Partial<Record<number, BalanceHandler>>;

    constructor() {
        const transfer = new TransferBalanceHandler();
        const cashback = new CashbackBalanceHandler();
        const reverse = new ReverseBalanceHandler();
        this.handlers = {
            [TransactionType.TRANSFER]: transfer,
            [TransactionType.REDEMPTION]: transfer,
            [TransactionType.SERVICES_PURCHASES]: transfer,
            [TransactionType.REDEMPTION_COUPON]: transfer,
            [TransactionType.COMMODOS_PURCHASE]: transfer,
            [TransactionType.CASHBACK]: cashback,
            [TransactionType.COMMODO_COMMISSION]: cashback,
            [TransactionType.TAX]: cashback,
            [TransactionType.SURCHARGE]: transfer,
            [TransactionType.PURCHASE_RETURNS]: cashback,
            [TransactionType.REVERSE]: reverse,
            [TransactionType.REFUND]: cashback,
            [TransactionType.CREDIT]: transfer,
            [TransactionType.SERVICE_PAYMENT]: transfer,
            [TransactionType.BONUS]: transfer,
            [TransactionType.STAMP_EXCHANGE]: cashback,
        };
    }

    async apply(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        const handler = this.handlers[movement.transactionType];
        if (!handler) {
            throw new MicrobalanceRuleError('unsupported_transaction_type', `Tipo de transacción no soportado: ${movement.transactionType}`);
        }
        await handler.execute(movement, unit);
    }
}
