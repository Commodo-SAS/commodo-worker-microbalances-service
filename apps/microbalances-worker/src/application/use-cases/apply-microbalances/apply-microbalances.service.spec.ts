import { InMemoryMicrobalanceStore, InMemoryMicrobalanceUnit } from '../../../../test/in-memory-microbalance-unit';
import { MicrobalanceEnvelope, MicrobalanceEventType } from '../../../domain/models/microbalance-event';
import { MicrobalanceDeadlineExceededError } from '../../../domain/errors/microbalance.errors';
import { ApplyMicrobalancesService } from './apply-microbalances.service';

function envelope(
    eventType: MicrobalanceEventType,
    payload: Record<string, unknown>,
    transactionId: number,
    environment = 'LOCAL',
): MicrobalanceEnvelope {
    return {
        eventId: `evt-${eventType}-${transactionId}`,
        eventType,
        version: 1,
        occurredAt: '2026-10-20T10:00:00.000Z',
        service: 'test',
        environment,
        correlationId: 'corr-1',
        transactionId: String(transactionId),
        payload,
    };
}

function cashback(transactionId = 100, overrides: Record<string, unknown> = {}, environment = 'LOCAL'): MicrobalanceEnvelope {
    return envelope(
        'cashback.created',
        {
            currency: 'COMMODO',
            userId: 7,
            transaction: {
                transactionId,
                transactionTypeId: 2,
                status: 'TRANSCONFIRMED',
                amount: '100',
                partnerId: 5,
                walletReceiverId: 12,
            },
            ...overrides,
        },
        transactionId,
        environment,
    );
}

function billing(transactionId: number, dependsOnTransactionId?: number): MicrobalanceEnvelope {
    return envelope(
        'billing.microbalances.requested',
        {
            transactionId,
            amount: '10',
            transactionTypeId: 3,
            dependsOnTransactionId,
            walletTransferId: 11,
            walletReceiverId: 30,
            createUserId: 8,
            allowSenderDebt: true,
        },
        transactionId,
    );
}

describe('ApplyMicrobalancesService', () => {
    let unit: InMemoryMicrobalanceUnit;
    let store: InMemoryMicrobalanceStore;
    let logger: { business: jest.Mock };
    let useCase: ApplyMicrobalancesService;
    const run = (event: MicrobalanceEnvelope, expectedEnvironment = 'local') =>
        useCase.execute({ envelope: event, expectedEnvironment, deadlineAt: Date.now() + 60000 });

    beforeEach(() => {
        unit = new InMemoryMicrobalanceUnit();
        [11, 12, 30].forEach((id) => unit.wallets.add(id));
        store = new InMemoryMicrobalanceStore(unit);
        logger = { business: jest.fn() };
        useCase = new ApplyMicrobalancesService(store, logger as never);
    });

    it('applies the microbalances of a cashback in one store transaction', async () => {
        const outcome = await run(cashback());

        expect(outcome).toEqual({ status: 'applied', applied: 1, skipped: 0 });
        expect(store.transactions).toBe(1);
        expect(unit.bagsOf(12)).toHaveLength(1);
    });

    it('applies the partner and wholesaler legs together', async () => {
        const event = cashback(100, {
            wholesalerTransaction: {
                transactionId: 101,
                transactionTypeId: 2,
                status: 'TRANSCONFIRMED',
                amount: '5',
                partnerId: 6,
                walletReceiverId: 12,
            },
        });

        expect(await run(event)).toEqual({ status: 'applied', applied: 2, skipped: 0 });
        expect(unit.bags.map((b) => b.transactionId)).toEqual([100, 101]);
    });

    it('ignores events from another environment without touching the database', async () => {
        const outcome = await run(cashback(100, {}, 'PROD'));

        expect(outcome).toEqual({ status: 'ignored', reason: 'environment_mismatch' });
        expect(store.transactions).toBe(0);
    });

    it('compares the environment case-insensitively', async () => {
        expect(await run(cashback(100, {}, 'local'), 'LOCAL')).toMatchObject({ status: 'applied' });
    });

    it('reports a duplicate delivery without applying anything again', async () => {
        const event = cashback();
        await run(event);

        expect(await run(event)).toEqual({ status: 'duplicate' });
        expect(unit.bags).toHaveLength(1);
    });

    it('claims the event but applies nothing when there is no registered user', async () => {
        const outcome = await run(cashback(100, { userId: undefined }));

        expect(outcome).toEqual({ status: 'ignored', reason: 'no_registered_user' });
        expect(unit.claimed.size).toBe(1);
        expect(unit.bags).toHaveLength(0);
    });

    it('skips a movement that already has microbalances, whatever event delivered it', async () => {
        await run(cashback(100));

        const sameMovementOtherEvent = envelope(
            'transaction.microbalances.requested',
            {
                transactionId: 100,
                transactionTypeId: 2,
                status: 'TRANSCONFIRMED',
                amount: '100',
                allowSenderDebt: false,
                userId: 7,
                walletReceiverId: 12,
            },
            100,
        );

        expect(await run(sameMovementOtherEvent)).toEqual({ status: 'applied', applied: 0, skipped: 1 });
        expect(unit.bags).toHaveLength(1);
    });

    it('skips a movement already applied through its references', async () => {
        unit.referenceRows.push({ id: 1, transactionId: 100, walletBalanceId: 1, amountUsed: 10 });

        expect(await run(cashback(100))).toEqual({ status: 'applied', applied: 0, skipped: 1 });
        expect(unit.bags).toHaveLength(0);
    });

    it('locks each involved wallet once', async () => {
        await run(cashback());

        expect(unit.lockedWallets).toEqual([[12]]);
    });

    it('fails when the sender or receiver wallet does not exist', async () => {
        unit.wallets.delete(12);

        await expect(run(cashback())).rejects.toMatchObject({ kind: 'rule', code: 'receiver_wallet_not_found' });

        unit.wallets.add(12);
        unit.wallets.delete(11);
        await expect(run(billing(400))).rejects.toMatchObject({ kind: 'rule', code: 'sender_wallet_not_found' });
    });

    it('skips a reversal that has neither wallet', async () => {
        const reversal = envelope(
            'transaction.microbalances.requested',
            { transactionId: 300, transactionTypeId: 12, status: 'TRANSCONFIRMED', amount: '10', allowSenderDebt: false, userId: 7, creditLineId: 4 },
            300,
        );

        expect(await run(reversal)).toEqual({ status: 'applied', applied: 0, skipped: 1 });
    });

    describe('billing child movements', () => {
        it('apply when they have no antecedent', async () => {
            expect(await run(billing(400))).toEqual({ status: 'applied', applied: 1, skipped: 0 });
        });

        it('wait for an antecedent without microbalances', async () => {
            await expect(run(billing(400, 100))).rejects.toMatchObject({ kind: 'dependency', code: 'antecedent_pending' });
            expect(unit.bags).toHaveLength(0);
        });

        it('apply once the antecedent has bags', async () => {
            await run(cashback(100));

            expect(await run(billing(400, 100))).toMatchObject({ status: 'applied', applied: 1 });
        });

        it('apply once the antecedent has references', async () => {
            unit.referenceRows.push({ id: 1, transactionId: 100, walletBalanceId: 1, amountUsed: 10 });

            expect(await run(billing(400, 100))).toMatchObject({ status: 'applied', applied: 1 });
        });

        it('apply when the antecedent belongs to an unregistered user, as the legacy logic skipped it', async () => {
            unit.transactions.set(100, { amount: 50, unregisteredUserId: 3 });

            expect(await run(billing(400, 100))).toMatchObject({ status: 'applied', applied: 1 });
        });

        it('apply when the antecedent has a zero amount', async () => {
            unit.transactions.set(100, { amount: 0 });

            expect(await run(billing(400, 100))).toMatchObject({ status: 'applied', applied: 1 });
        });

        it('wait when the antecedent transaction is registered but not processed', async () => {
            unit.transactions.set(100, { amount: 50 });

            await expect(run(billing(400, 100))).rejects.toMatchObject({ kind: 'dependency' });
        });

        it('do not wait for an antecedent when they were already applied', async () => {
            await run(billing(400));

            expect(await run(billing(400, 100))).toEqual({ status: 'duplicate' });

            const otherEvent = envelope('billing.microbalances.requested', { ...billing(400, 100).payload }, 400);
            otherEvent.eventId = 'another-event-for-the-same-movement';
            expect(await run(otherEvent)).toEqual({ status: 'applied', applied: 0, skipped: 1 });
        });

        it('resolve a tax then commission chain in order', async () => {
            await run(cashback(100));
            await run(billing(400, 100));

            expect(await run(billing(401, 400))).toMatchObject({ status: 'applied', applied: 1 });
        });
    });

    it('propagates a rule failure so the whole event is rolled back and retried', async () => {
        const redemption = envelope(
            'redemption.completed',
            {
                currency: 'COMMODO',
                userId: 7,
                transaction: {
                    transactionId: 200,
                    transactionTypeId: 1,
                    status: 'TRANSCONFIRMED',
                    amount: '100',
                    partnerId: 5,
                    walletTransferId: 11,
                    walletReceiverId: 30,
                },
            },
            200,
        );

        await expect(run(redemption)).rejects.toMatchObject({ kind: 'rule', code: 'insufficient_balance' });
    });

    it('logs skipped movements without amounts or users', async () => {
        unit.referenceRows.push({ id: 1, transactionId: 100, walletBalanceId: 1, amountUsed: 10 });

        await run(cashback(100));

        expect(logger.business).toHaveBeenCalledTimes(1);
        const [input] = logger.business.mock.calls[0];
        expect(input).toMatchObject({
            event: 'microbalances.movement.skipped',
            business: { reason: 'already_applied', transactionId: 100, transactionTypeId: 2 },
        });
        expect(JSON.stringify(input)).not.toMatch(/amount|userId/);
    });

    it('rolls back instead of applying a movement once the time budget is exhausted', async () => {
        await expect(useCase.execute({ envelope: cashback(), expectedEnvironment: 'local', deadlineAt: Date.now() - 1 })).rejects.toThrow(
            MicrobalanceDeadlineExceededError,
        );

        expect(unit.bags).toHaveLength(0);
    });
});
