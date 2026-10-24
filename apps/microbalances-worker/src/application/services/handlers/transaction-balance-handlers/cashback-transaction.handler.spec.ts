import { InMemoryMicrobalanceUnit } from '../../../../../test/in-memory-microbalance-unit';
import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { TransactionType, WalletBalanceStatus } from '../../../../domain/enums/transaction-type.enum';
import { CashbackTransactionHandler } from './cashback-transaction.handler';

const RECEIVER = 20;

function movement(overrides: Partial<MicrobalanceMovement> = {}): MicrobalanceMovement {
    return {
        transactionId: 900,
        transactionType: TransactionType.CASHBACK,
        amount: 100,
        walletReceiverId: RECEIVER,
        hasCreditLine: false,
        allowSenderDebt: false,
        createUserId: 7,
        ...overrides,
    };
}

describe('CashbackTransactionHandler', () => {
    let unit: InMemoryMicrobalanceUnit;
    const handler = new CashbackTransactionHandler();

    beforeEach(() => {
        unit = new InMemoryMicrobalanceUnit();
    });

    it('creates one available bag for the receiver', async () => {
        await handler.execute(movement(), unit);

        expect(unit.bags).toEqual([
            {
                id: expect.any(Number),
                walletId: RECEIVER,
                transactionId: 900,
                originalAmount: 100,
                availableAmount: 100,
                balanceStatus: WalletBalanceStatus.AVAILABLE,
            },
        ]);
        expect(unit.referenceRows).toHaveLength(0);
    });

    it('covers the receiver debt bags and keeps the remainder in the new bag', async () => {
        const debt = unit.seedBag(RECEIVER, 1, -30);

        await handler.execute(movement({ amount: 100 }), unit);

        expect(unit.bags.find((b) => b.id === debt.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.USED });
        expect(unit.bagsOf(RECEIVER).find((b) => b.transactionId === 900).availableAmount).toBe(70);
        expect(unit.referenceRows).toEqual([{ id: 1, transactionId: 900, walletBalanceId: debt.id, amountUsed: 30, createdBy: 7 }]);
    });

    it('uses the whole new bag when the debt is larger than the cashback', async () => {
        const debt = unit.seedBag(RECEIVER, 1, -250);

        await handler.execute(movement({ amount: 100 }), unit);

        expect(unit.bags.find((b) => b.id === debt.id)).toMatchObject({ availableAmount: -150, balanceStatus: WalletBalanceStatus.AVAILABLE });
        expect(unit.bagsOf(RECEIVER).find((b) => b.transactionId === 900)).toMatchObject({
            availableAmount: 0,
            balanceStatus: WalletBalanceStatus.USED,
        });
    });

    it('covers older debt first', async () => {
        const older = unit.seedBag(RECEIVER, 1, -20);
        const newer = unit.seedBag(RECEIVER, 2, -50);

        await handler.execute(movement({ amount: 40 }), unit);

        expect(unit.bags.find((b) => b.id === older.id).availableAmount).toBe(0);
        expect(unit.bags.find((b) => b.id === newer.id).availableAmount).toBe(-30);
    });

    it('requires the receiver wallet', async () => {
        await expect(handler.execute(movement({ walletReceiverId: undefined }), unit)).rejects.toMatchObject({
            kind: 'rule',
            code: 'wallet_missing',
        });
    });
});
