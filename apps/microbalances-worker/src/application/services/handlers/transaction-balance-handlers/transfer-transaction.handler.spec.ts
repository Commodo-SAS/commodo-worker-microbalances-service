import { InMemoryMicrobalanceUnit } from '../../../../../test/in-memory-microbalance-unit';
import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { TransactionType, WalletBalanceStatus } from '../../../../domain/enums/transaction-type.enum';
import { TransferTransactionHandler } from './transfer-transaction.handler';

const SENDER = 10;
const RECEIVER = 20;

function movement(overrides: Partial<MicrobalanceMovement> = {}): MicrobalanceMovement {
    return {
        transactionId: 900,
        transactionType: TransactionType.TRANSFER,
        amount: 100,
        walletTransferId: SENDER,
        walletReceiverId: RECEIVER,
        hasCreditLine: false,
        allowSenderDebt: false,
        createUserId: 7,
        ...overrides,
    };
}

describe('TransferTransactionHandler', () => {
    let unit: InMemoryMicrobalanceUnit;
    const handler = new TransferTransactionHandler();

    beforeEach(() => {
        unit = new InMemoryMicrobalanceUnit();
    });

    it('consumes the sender bags oldest first and creates one receiver bag per consumed bag', async () => {
        const first = unit.seedBag(SENDER, 1, 100);
        const second = unit.seedBag(SENDER, 2, 50);

        await handler.execute(movement({ amount: 120 }), unit);

        expect(unit.bags.find((b) => b.id === first.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.USED });
        expect(unit.bags.find((b) => b.id === second.id)).toMatchObject({ availableAmount: 30, balanceStatus: WalletBalanceStatus.AVAILABLE });
        expect(unit.referenceRows.map((r) => [r.walletBalanceId, r.amountUsed])).toEqual([
            [first.id, 100],
            [second.id, 20],
        ]);
        expect(unit.bagsOf(RECEIVER).map((b) => b.availableAmount)).toEqual([100, 20]);
    });

    it('skips debt bags because they are not spendable credit', async () => {
        unit.seedBag(SENDER, 1, -40);
        const spendable = unit.seedBag(SENDER, 2, 100);

        await handler.execute(movement({ amount: 60 }), unit);

        expect(unit.bags.find((b) => b.id === spendable.id).availableAmount).toBe(40);
        expect(unit.bagsOf(SENDER).find((b) => b.transactionId === 1).availableAmount).toBe(-40);
    });

    it('covers the receiver debt bags with the new bag', async () => {
        unit.seedBag(SENDER, 1, 100);
        const debt = unit.seedBag(RECEIVER, 3, -40);

        await handler.execute(movement({ amount: 100 }), unit);

        expect(unit.bags.find((b) => b.id === debt.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.USED });
        const created = unit.bagsOf(RECEIVER).find((b) => b.transactionId === 900);
        expect(created.availableAmount).toBe(60);
        expect(unit.referenceRows.find((r) => r.walletBalanceId === debt.id).amountUsed).toBe(40);
    });

    it('rejects an insufficient balance when sender debt is not allowed', async () => {
        unit.seedBag(SENDER, 1, 30);

        await expect(handler.execute(movement({ amount: 100 }), unit)).rejects.toMatchObject({ kind: 'rule', code: 'insufficient_balance' });
    });

    it('creates a sender debt bag for the missing amount when sender debt is allowed', async () => {
        unit.seedBag(SENDER, 1, 30);

        await handler.execute(movement({ amount: 100, allowSenderDebt: true }), unit);

        const debt = unit.bagsOf(SENDER).find((b) => b.transactionId === 900);
        expect(debt).toMatchObject({ originalAmount: -70, availableAmount: -70, balanceStatus: WalletBalanceStatus.AVAILABLE });
        expect(unit.referenceRows.find((r) => r.walletBalanceId === debt.id).amountUsed).toBe(70);
        expect(unit.bagsOf(RECEIVER).reduce((sum, b) => sum + b.availableAmount, 0)).toBe(100);
    });

    it('creates the debt bag for the whole amount when the sender has no bags', async () => {
        await handler.execute(movement({ amount: 50, allowSenderDebt: true }), unit);

        expect(unit.bagsOf(SENDER)).toHaveLength(1);
        expect(unit.bagsOf(SENDER)[0].availableAmount).toBe(-50);
        expect(unit.bagsOf(RECEIVER)[0].availableAmount).toBe(50);
    });

    it('requires the sender wallet', async () => {
        await expect(handler.execute(movement({ walletTransferId: undefined }), unit)).rejects.toMatchObject({ code: 'wallet_missing' });
    });

    it('requires the receiver wallet unless a credit lands on a credit line', async () => {
        unit.seedBag(SENDER, 1, 100);

        await expect(handler.execute(movement({ walletReceiverId: undefined }), unit)).rejects.toMatchObject({ code: 'wallet_missing' });
        await expect(
            handler.execute(movement({ transactionType: TransactionType.CREDIT, walletReceiverId: undefined, hasCreditLine: true }), unit),
        ).resolves.toBeUndefined();
    });

    it('does not create receiver bags for a credit to a credit line', async () => {
        unit.seedBag(SENDER, 1, 100);

        await handler.execute(movement({ transactionType: TransactionType.CREDIT, walletReceiverId: undefined, amount: 60 }), unit);

        expect(unit.bagsOf(RECEIVER)).toHaveLength(0);
        expect(unit.bagsOf(SENDER)[0].availableAmount).toBe(40);
        expect(unit.referenceRows).toHaveLength(1);
    });
});
