import { MicrobalanceRuleError } from '../../domain/errors/microbalance.errors';
import { MicrobalanceMovement } from '../../domain/interfaces/microbalance-movement.interface';
import { BalanceUnit } from '../../domain/ports/secondary/microbalance-store.port';
import { TransactionType } from '../../domain/enums/transaction-type.enum';
import { TransactionHandler } from './handlers/transaction-balance-handlers/base-transaction.handler';
import { CashbackTransactionHandler } from './handlers/transaction-balance-handlers/cashback-transaction.handler';
import { ReverseTransactionHandler } from './handlers/transaction-balance-handlers/reverse-transaction.handler';
import { TransferTransactionHandler } from './handlers/transaction-balance-handlers/transfer-transaction.handler';

/** Routes a movement to the balance rule of its transaction type, with the same mapping as the legacy balance manager. */
export class TransactionBalanceManagerService {
    private readonly handlers: Partial<Record<number, TransactionHandler>>;

    /** Builds the transaction-type to balance-rule map, identical to the legacy manager. */
    constructor() {
        const transfer = new TransferTransactionHandler();
        const cashback = new CashbackTransactionHandler();
        const reverse = new ReverseTransactionHandler();
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

    /**
     * Applies the balance rule that corresponds to the movement transaction type.
     * @throws MicrobalanceRuleError when the type has no rule or the rule rejects the movement.
     */
    async apply(movement: MicrobalanceMovement, unit: BalanceUnit): Promise<void> {
        // Pick the rule of the transaction type; unsupported types are rejected.
        const handler = this.handlers[movement.transactionType];
        if (!handler) {
            throw new MicrobalanceRuleError('unsupported_transaction_type', `Tipo de transacción no soportado: ${movement.transactionType}`);
        }
        await handler.execute(movement, unit);
    }
}
