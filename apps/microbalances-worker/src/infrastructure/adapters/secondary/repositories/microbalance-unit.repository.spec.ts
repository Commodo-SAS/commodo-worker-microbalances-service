import { markProcessed } from '@commodo-sas/shared-libs/sqs';
import { TransactionBalanceReferenceRow } from './entities/transaction-balance-reference.entity';
import { TransactionRow } from './entities/transaction.entity';
import { MICROBALANCES_CONSUMER, MicrobalanceUnitRepository } from './microbalance-unit.repository';
import { WalletBalanceRow } from './entities/wallet-balance.entity';

jest.mock('@commodo-sas/shared-libs/sqs', () => ({ markProcessed: jest.fn(), EventProcessingLogEntity: class {}, ProcessedEventEntity: class {} }));

describe('MicrobalanceUnitRepository', () => {
    let references: boolean;
    let bags: boolean;
    let transaction: Partial<TransactionRow> | null;
    let manager: { exists: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock; createQueryBuilder: jest.Mock };
    let unit: MicrobalanceUnitRepository;

    beforeEach(() => {
        references = false;
        bags = false;
        transaction = null;
        manager = {
            exists: jest.fn(async (entity: unknown) =>
                entity === TransactionBalanceReferenceRow ? references : entity === WalletBalanceRow ? bags : false,
            ),
            findOne: jest.fn(async () => transaction),
            create: jest.fn((_entity: unknown, input: object) => ({ ...input })),
            save: jest.fn(async (_entity: unknown, row: object) => ({ id: 77, ...row })),
            update: jest.fn(),
            createQueryBuilder: jest.fn(),
        };
        unit = new MicrobalanceUnitRepository(manager as never);
    });

    it('claims the event for the microbalances consumer inside the business manager', async () => {
        (markProcessed as jest.Mock).mockResolvedValueOnce(true);

        await expect(unit.claimEvent('evt-1', 'cashback.created')).resolves.toBe(true);
        expect(markProcessed).toHaveBeenCalledWith(manager, { consumer: MICROBALANCES_CONSUMER, eventId: 'evt-1', eventType: 'cashback.created' });
    });

    describe('isMovementApplied', () => {
        it('is true when the movement has references', async () => {
            references = true;

            await expect(unit.isMovementApplied(100, 12)).resolves.toBe(true);
        });

        it('is true when the receiver already has bags for the movement', async () => {
            bags = true;

            await expect(unit.isMovementApplied(100, 12)).resolves.toBe(true);
            expect(manager.exists).toHaveBeenLastCalledWith(WalletBalanceRow, { where: { transactionId: 100, walletId: 12 } });
        });

        it('is false without references and without a receiver wallet', async () => {
            bags = true;

            await expect(unit.isMovementApplied(100)).resolves.toBe(false);
        });

        it('is false when nothing was applied', async () => {
            await expect(unit.isMovementApplied(100, 12)).resolves.toBe(false);
        });
    });

    describe('isAntecedentSettled', () => {
        it('is true with references or with bags on any wallet', async () => {
            references = true;
            await expect(unit.isAntecedentSettled(100)).resolves.toBe(true);

            references = false;
            bags = true;
            await expect(unit.isAntecedentSettled(100)).resolves.toBe(true);
            expect(manager.exists).toHaveBeenLastCalledWith(WalletBalanceRow, { where: { transactionId: 100 } });
        });

        it('is true for an unregistered user transaction, which the legacy logic never processed', async () => {
            transaction = { id: 100, amount: 50, unregisteredUserId: 3 };

            await expect(unit.isAntecedentSettled(100)).resolves.toBe(true);
        });

        it('is true for a zero amount transaction, which produces no bags', async () => {
            transaction = { id: 100, amount: 0 };

            await expect(unit.isAntecedentSettled(100)).resolves.toBe(true);
        });

        it('is false for a registered transaction without microbalances', async () => {
            transaction = { id: 100, amount: 50 };

            await expect(unit.isAntecedentSettled(100)).resolves.toBe(false);
        });

        it('is false when the antecedent transaction does not exist', async () => {
            await expect(unit.isAntecedentSettled(100)).resolves.toBe(false);
        });
    });

    describe('lockWallets', () => {
        it('does not query when there is nothing to lock', async () => {
            await expect(unit.lockWallets([])).resolves.toEqual([]);
            expect(manager.createQueryBuilder).not.toHaveBeenCalled();
        });

        it('locks the wallets for update in ascending id order and returns the ones found', async () => {
            const query = {
                setLock: jest.fn().mockReturnThis(),
                where: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([{ id: 11 }, { id: 30 }]),
            };
            manager.createQueryBuilder.mockReturnValue(query);

            await expect(unit.lockWallets([30, 11, 99])).resolves.toEqual([11, 30]);
            expect(query.setLock).toHaveBeenCalledWith('pessimistic_write');
            expect(query.orderBy).toHaveBeenCalledWith('wallet.id', 'ASC');
            expect(query.where).toHaveBeenCalledWith('wallet.id IN (:...walletIds)', { walletIds: [30, 11, 99] });
        });
    });

    describe('wallet bags and references', () => {
        it('persists a bag and maps it to a record', async () => {
            const record = await unit.walletBalances.create({
                transactionId: 100,
                walletId: 12,
                originalAmount: 10,
                availableAmount: 10,
                expirationDate: new Date('2027-01-01'),
                createdBy: 7,
            });

            expect(record).toMatchObject({ id: 77, walletId: 12, transactionId: 100, availableAmount: 10 });
            expect(manager.save).toHaveBeenCalledWith(WalletBalanceRow, expect.objectContaining({ createdBy: 7 }));
        });

        it('updates a bag by id with the changed fields only', async () => {
            await unit.walletBalances.update(5, { availableAmount: 0, updatedBy: 7 });

            expect(manager.update).toHaveBeenCalledWith(WalletBalanceRow, { id: 5 }, { availableAmount: 0, updatedBy: 7 });
        });

        it('persists a reference', async () => {
            await unit.references.create({ transactionId: 100, walletBalanceId: 5, amountUsed: 3, createdBy: 7 });

            expect(manager.save).toHaveBeenCalledWith(TransactionBalanceReferenceRow, {
                transactionId: 100,
                walletBalanceId: 5,
                amountUsed: 3,
                createdBy: 7,
            });
        });
    });
});
