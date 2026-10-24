import { InMemoryMicrobalanceUnit } from '../../../test/in-memory-microbalance-unit';
import { MicrobalanceMovement } from '../../domain/interfaces/microbalance-movement.interface';
import { TransactionType } from '../../domain/enums/transaction-type.enum';
import { TransactionBalanceManagerService } from './transaction-balance-manager.service';

function movement(transactionType: number, overrides: Partial<MicrobalanceMovement> = {}): MicrobalanceMovement {
    return {
        transactionId: 900,
        transactionType,
        amount: 100,
        walletTransferId: 10,
        walletReceiverId: 20,
        hasCreditLine: false,
        allowSenderDebt: true,
        createUserId: 7,
        ...overrides,
    };
}

describe('TransactionBalanceManagerService', () => {
    const manager = new TransactionBalanceManagerService();

    it.each([
        TransactionType.CASHBACK,
        TransactionType.COMMODO_COMMISSION,
        TransactionType.TAX,
        TransactionType.PURCHASE_RETURNS,
        TransactionType.REFUND,
        TransactionType.STAMP_EXCHANGE,
    ])('routes type %s to the cashback rule (one receiver bag, no sender reads)', async (type) => {
        const unit = new InMemoryMicrobalanceUnit();

        await manager.apply(movement(type, { walletTransferId: undefined }), unit);

        expect(unit.bags).toHaveLength(1);
        expect(unit.bags[0].walletId).toBe(20);
    });

    it.each([
        TransactionType.TRANSFER,
        TransactionType.REDEMPTION,
        TransactionType.SERVICES_PURCHASES,
        TransactionType.REDEMPTION_COUPON,
        TransactionType.COMMODOS_PURCHASE,
        TransactionType.SURCHARGE,
        TransactionType.CREDIT,
        TransactionType.SERVICE_PAYMENT,
        TransactionType.BONUS,
    ])('routes type %s to the transfer rule (sender debt bag when the sender is empty)', async (type) => {
        const unit = new InMemoryMicrobalanceUnit();

        await manager.apply(movement(type), unit);

        expect(unit.bagsOf(10)).toHaveLength(1);
        expect(unit.bagsOf(10)[0].availableAmount).toBe(-100);
    });

    it('routes reversals to the reverse rule', async () => {
        const unit = new InMemoryMicrobalanceUnit();
        unit.seedBag(10, 100, 100);

        await manager.apply(movement(TransactionType.REVERSE, { reverseParentTransactionId: 100 }), unit);

        expect(unit.bagsOf(10)[0].balanceStatus).toBe('REVERSED');
    });

    it.each([16, 18, 19, 20, 21, 99])('rejects the unsupported transaction type %s', async (type) => {
        await expect(manager.apply(movement(type), new InMemoryMicrobalanceUnit())).rejects.toMatchObject({
            kind: 'rule',
            code: 'unsupported_transaction_type',
        });
    });
});
