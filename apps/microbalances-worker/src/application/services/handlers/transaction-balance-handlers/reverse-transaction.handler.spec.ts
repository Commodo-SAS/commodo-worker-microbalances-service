import { InMemoryMicrobalanceUnit } from '../../../../../test/in-memory-microbalance-unit';
import { MicrobalanceMovement } from '../../../../domain/interfaces/microbalance-movement.interface';
import { TransactionType, WalletBalanceStatus } from '../../../../domain/enums/transaction-type.enum';
import { ReverseTransactionHandler } from './reverse-transaction.handler';

const USER_WALLET = 10;
const PARTNER_WALLET = 20;
const ORIGINAL = 100;

function movement(overrides: Partial<MicrobalanceMovement> = {}): MicrobalanceMovement {
    return {
        transactionId: 900,
        transactionType: TransactionType.REVERSE,
        amount: 100,
        walletTransferId: USER_WALLET,
        walletReceiverId: PARTNER_WALLET,
        hasCreditLine: false,
        reverseParentTransactionId: ORIGINAL,
        allowSenderDebt: false,
        createUserId: 7,
        ...overrides,
    };
}

describe('ReverseTransactionHandler', () => {
    let unit: InMemoryMicrobalanceUnit;
    const handler = new ReverseTransactionHandler();

    beforeEach(() => {
        unit = new InMemoryMicrobalanceUnit();
    });

    it('marks the original bag as reversed when it is fully drawn and credits the receiver', async () => {
        const original = unit.seedBag(USER_WALLET, ORIGINAL, 100);

        await handler.execute(movement({ amount: 100 }), unit);

        expect(unit.bags.find((b) => b.id === original.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.REVERSED });
        expect(unit.referenceRows.map((r) => [r.walletBalanceId, r.amountUsed])).toEqual([[original.id, 100]]);
        expect(unit.bagsOf(PARTNER_WALLET).map((b) => b.availableAmount)).toEqual([100]);
    });

    it('keeps the original bag available when it is only partially drawn', async () => {
        const original = unit.seedBag(USER_WALLET, ORIGINAL, 100);

        await handler.execute(movement({ amount: 40 }), unit);

        expect(unit.bags.find((b) => b.id === original.id)).toMatchObject({ availableAmount: 60, balanceStatus: WalletBalanceStatus.AVAILABLE });
    });

    it('draws the original bags before the other positive bags', async () => {
        const other = unit.seedBag(USER_WALLET, 1, 500);
        const original = unit.seedBag(USER_WALLET, ORIGINAL, 100);

        await handler.execute(movement({ amount: 150 }), unit);

        expect(unit.bags.find((b) => b.id === original.id).availableAmount).toBe(0);
        expect(unit.bags.find((b) => b.id === other.id).availableAmount).toBe(450);
        expect(unit.referenceRows.map((r) => r.walletBalanceId)).toEqual([original.id, other.id]);
    });

    it('marks a drawn non-original bag as used when it reaches zero', async () => {
        const other = unit.seedBag(USER_WALLET, 1, 30);

        await handler.execute(movement({ amount: 30 }), unit);

        expect(unit.bags.find((b) => b.id === other.id)).toMatchObject({ availableAmount: 0, balanceStatus: WalletBalanceStatus.USED });
    });

    it('creates a debt bag for the remainder when there is no debt bag yet', async () => {
        unit.seedBag(USER_WALLET, ORIGINAL, 100);

        await handler.execute(movement({ amount: 150 }), unit);

        const debt = unit.bagsOf(USER_WALLET).find((b) => b.transactionId === 900);
        expect(debt).toMatchObject({ originalAmount: -50, availableAmount: -50 });
        expect(unit.bagsOf(PARTNER_WALLET).reduce((sum, b) => sum + b.availableAmount, 0)).toBe(150);
    });

    it('deepens the existing debt bag for the remainder', async () => {
        const debt = unit.seedBag(USER_WALLET, 1, -20);

        await handler.execute(movement({ amount: 50 }), unit);

        expect(unit.bags.find((b) => b.id === debt.id).availableAmount).toBe(-70);
        expect(unit.referenceRows).toEqual([{ id: 1, transactionId: 900, walletBalanceId: debt.id, amountUsed: 50, createdBy: 7 }]);
        expect(unit.bagsOf(PARTNER_WALLET)[0].availableAmount).toBe(50);
    });

    it('does not credit a receiver wallet when a credit line receives the reversal', async () => {
        unit.seedBag(USER_WALLET, ORIGINAL, 100);

        await handler.execute(movement({ walletReceiverId: undefined, hasCreditLine: true, amount: 100 }), unit);

        expect(unit.bagsOf(PARTNER_WALLET)).toHaveLength(0);
        expect(unit.referenceRows).toHaveLength(1);
    });

    it('requires the reversed transaction and the sender wallet', async () => {
        await expect(handler.execute(movement({ reverseParentTransactionId: undefined }), unit)).rejects.toMatchObject({
            code: 'reverse_parent_missing',
        });
        await expect(handler.execute(movement({ walletTransferId: undefined }), unit)).rejects.toMatchObject({ code: 'wallet_missing' });
    });

    it('requires the receiver wallet when there is no credit line', async () => {
        await expect(handler.execute(movement({ walletReceiverId: undefined }), unit)).rejects.toMatchObject({ code: 'wallet_missing' });
    });
});
