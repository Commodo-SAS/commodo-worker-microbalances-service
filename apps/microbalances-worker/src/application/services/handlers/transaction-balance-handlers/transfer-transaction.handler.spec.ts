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

    it('reads the sender bags by pages and keeps drawing until the amount is covered', async () => {
        // 450 bags of 1 need three pages of 200, so the handler must ask for the next page twice.
        const bags = Array.from({ length: 450 }, (_, i) => unit.seedBag(SENDER, i + 1, 1));
        const pages = jest.spyOn(unit.walletBalances, 'findSpendableByWalletId');

        await handler.execute(movement({ amount: 450 }), unit);

        expect(pages.mock.calls.length).toBeGreaterThanOrEqual(3);
        expect(bags.every((seed) => unit.bags.find((b) => b.id === seed.id)?.balanceStatus === WalletBalanceStatus.USED)).toBe(true);
        expect(unit.bagsOf(RECEIVER)).toHaveLength(450);
    });

    it('does not spend the bags its own self transfer creates and terminates', async () => {
        const original = unit.seedBag(SENDER, 1, 100);

        await handler.execute(movement({ amount: 60, walletReceiverId: SENDER }), unit);

        expect(unit.bags.find((b) => b.id === original.id)?.availableAmount).toBe(40);
        expect(unit.bags.filter((b) => b.transactionId === 900).map((b) => b.availableAmount)).toEqual([60]);
    });

    it('treats binary residues as exhausted bags: 0.1 + 0.2 covers 0.3 with no shortfall', async () => {
        const small = unit.seedBag(SENDER, 1, 0.1);
        const larger = unit.seedBag(SENDER, 2, 0.2);

        await handler.execute(movement({ amount: 0.3 }), unit);

        expect(unit.bags.find((b) => b.id === small.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.USED });
        expect(unit.bags.find((b) => b.id === larger.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.USED });
    });
});
