import { MicrobalanceEnvelope, movementsFromEnvelope, parseEnvelope } from './microbalance-event';
import { TransactionType } from '../enums/transaction-type.enum';

function envelope(eventType: string, payload: Record<string, unknown>, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        eventId: 'evt-1',
        eventType,
        version: 1,
        occurredAt: '2026-10-20T10:00:00.000Z',
        service: 'commodo-transaction-manager-integrations',
        environment: 'LOCAL',
        correlationId: 'corr-1',
        transactionId: String(payload.transactionId ?? (payload.transaction as { transactionId: number })?.transactionId),
        payload,
        ...overrides,
    };
}

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        transactionId: 100,
        transactionTypeId: 2,
        status: 'TRANSCONFIRMED',
        amount: '25.50',
        partnerId: 5,
        walletTransferId: 11,
        walletReceiverId: 12,
        ...overrides,
    };
}

function parsed(raw: Record<string, unknown>): MicrobalanceEnvelope {
    return parseEnvelope(raw);
}

describe('parseEnvelope', () => {
    const valid = () => envelope('cashback.created', { currency: 'COMMODO', transaction: snapshot() });

    it('accepts a valid envelope and tolerates additional fields', () => {
        const result = parseEnvelope({ ...valid(), futureField: { nested: true }, traceparent: '00-abc-def-01' });

        expect(result).toMatchObject({ eventId: 'evt-1', eventType: 'cashback.created', traceparent: '00-abc-def-01' });
    });

    it.each([
        ['a non-object body', 'text'],
        ['an array body', []],
        ['a null body', null],
    ])('rejects %s', (_name, value) => {
        expect(() => parseEnvelope(value)).toThrow(expect.objectContaining({ kind: 'contract', code: 'invalid_envelope' }));
    });

    it('rejects an unsupported event type or version', () => {
        expect(() => parseEnvelope({ ...valid(), eventType: 'raffle.created' })).toThrow(expect.objectContaining({ code: 'unsupported_event' }));
        expect(() => parseEnvelope({ ...valid(), version: 2 })).toThrow(expect.objectContaining({ code: 'unsupported_event' }));
    });

    it('rejects a missing payload', () => {
        expect(() => parseEnvelope({ ...valid(), payload: undefined })).toThrow(expect.objectContaining({ code: 'invalid_envelope' }));
    });

    it.each(['eventId', 'service', 'environment', 'correlationId', 'transactionId'])('rejects an empty %s', (field) => {
        expect(() => parseEnvelope({ ...valid(), [field]: '' })).toThrow(expect.objectContaining({ code: 'invalid_envelope' }));
    });

    it('limits the event id to the 64 characters accepted by processed_events', () => {
        expect(() => parseEnvelope({ ...valid(), eventId: 'a'.repeat(64) })).not.toThrow();
        expect(() => parseEnvelope({ ...valid(), eventId: 'a'.repeat(65) })).toThrow(expect.objectContaining({ code: 'invalid_envelope' }));
    });

    it('rejects an unparseable occurredAt', () => {
        expect(() => parseEnvelope({ ...valid(), occurredAt: 'yesterday' })).toThrow(expect.objectContaining({ code: 'invalid_envelope' }));
    });
});

describe('cashback.created', () => {
    const cashback = (payload: Record<string, unknown>, overrides: Record<string, unknown> = {}) =>
        parsed(envelope('cashback.created', { currency: 'COMMODO', userId: 7, transaction: snapshot(), ...payload }, overrides));

    it('maps the partner leg to a movement', () => {
        expect(movementsFromEnvelope(cashback({}))).toEqual([
            {
                transactionId: 100,
                transactionType: TransactionType.CASHBACK,
                amount: 25.5,
                walletTransferId: 11,
                walletReceiverId: 12,
                hasCreditLine: false,
                allowSenderDebt: false,
                createUserId: 7,
            },
        ]);
    });

    it('maps the wholesaler leg as an additional movement using the partner transaction type', () => {
        const movements = movementsFromEnvelope(
            cashback({ wholesalerTransaction: snapshot({ transactionId: 101, transactionTypeId: 2, amount: '4' }) }),
        );

        expect(movements.map((m) => [m.transactionId, m.transactionType, m.amount])).toEqual([
            [100, TransactionType.CASHBACK, 25.5],
            [101, TransactionType.CASHBACK, 4],
        ]);
    });

    it('accepts pending cashback as the legacy logic did', () => {
        expect(movementsFromEnvelope(cashback({ transaction: snapshot({ status: 'TRANSPENDING' }) }))).toHaveLength(1);
    });

    it('produces no movements without a registered user', () => {
        expect(movementsFromEnvelope(cashback({ userId: undefined }))).toEqual([]);
    });

    it('reads allowSenderDebt when the producer sends it and defaults to false otherwise', () => {
        expect(movementsFromEnvelope(cashback({ allowSenderDebt: true }))[0].allowSenderDebt).toBe(true);
        expect(movementsFromEnvelope(cashback({}))[0].allowSenderDebt).toBe(false);
    });

    it('flags a credit line reference', () => {
        expect(movementsFromEnvelope(cashback({ transaction: snapshot({ creditLineId: 9 }) }))[0].hasCreditLine).toBe(true);
    });

    it('ignores the historical raffle snapshot', () => {
        expect(movementsFromEnvelope(cashback({ raffle: { products: 'not validated' } }))).toHaveLength(1);
    });

    it.each([
        ['another currency', { currency: 'USD' }],
        ['a redemption transaction type', { transaction: snapshot({ transactionTypeId: 1 }) }],
        ['a status other than confirmed or pending', { transaction: snapshot({ status: 'TRANSREVERSED' }) }],
        ['a non-decimal amount', { transaction: snapshot({ amount: 'abc' }) }],
        ['a numeric amount', { transaction: snapshot({ amount: 25.5 }) }],
        ['a non-positive wallet id', { transaction: snapshot({ walletReceiverId: 0 }) }],
        ['a missing partner', { transaction: snapshot({ partnerId: undefined }) }],
        ['an invalid wholesaler leg', { wholesalerTransaction: snapshot({ amount: 'x' }) }],
        ['an invalid user id', { userId: -1 }],
    ])('rejects %s', (_name, payload) => {
        expect(() => movementsFromEnvelope(cashback(payload))).toThrow(expect.objectContaining({ kind: 'contract' }));
    });

    it('rejects a transaction identity that does not match the envelope', () => {
        expect(() => movementsFromEnvelope(cashback({}, { transactionId: '999' }))).toThrow(expect.objectContaining({ kind: 'contract' }));
    });
});

describe('redemption.completed', () => {
    const redemption = (payload: Record<string, unknown> = {}) =>
        parsed(
            envelope('redemption.completed', {
                currency: 'COMMODO',
                userId: 7,
                transaction: snapshot({ transactionTypeId: 1 }),
                ...payload,
            }),
        );

    it('maps both legs as redemptions', () => {
        const movements = movementsFromEnvelope(redemption({ wholesalerTransaction: snapshot({ transactionId: 101, transactionTypeId: 1 }) }));

        expect(movements.map((m) => m.transactionType)).toEqual([TransactionType.REDEMPTION, TransactionType.REDEMPTION]);
    });

    it('requires a confirmed redemption', () => {
        expect(() => movementsFromEnvelope(redemption({ transaction: snapshot({ transactionTypeId: 1, status: 'TRANSPENDING' }) }))).toThrow(
            expect.objectContaining({ kind: 'contract' }),
        );
        expect(() => movementsFromEnvelope(redemption({ transaction: snapshot({ transactionTypeId: 2 }) }))).toThrow(
            expect.objectContaining({ kind: 'contract' }),
        );
    });
});

describe('transaction.microbalances.requested', () => {
    const requested = (payload: Record<string, unknown> = {}) =>
        parsed(
            envelope('transaction.microbalances.requested', {
                transactionId: 300,
                transactionTypeId: 12,
                status: 'TRANSCONFIRMED',
                amount: '10',
                allowSenderDebt: true,
                userId: 7,
                walletTransferId: 11,
                walletReceiverId: 12,
                reverseParentTransactionId: 250,
                ...payload,
            }),
        );

    it('maps the single movement with its reversal reference', () => {
        expect(movementsFromEnvelope(requested())).toEqual([
            {
                transactionId: 300,
                transactionType: TransactionType.REVERSE,
                amount: 10,
                walletTransferId: 11,
                walletReceiverId: 12,
                hasCreditLine: false,
                reverseParentTransactionId: 250,
                allowSenderDebt: true,
                createUserId: 7,
            },
        ]);
    });

    it('treats a credit line as the replacement of the receiver wallet', () => {
        const [movement] = movementsFromEnvelope(requested({ walletReceiverId: undefined, creditLineId: 4 }));

        expect(movement).toMatchObject({ hasCreditLine: true, walletReceiverId: undefined });
    });

    it('tolerates null optional references', () => {
        expect(movementsFromEnvelope(requested({ creditLineId: null, parentTransactionId: null, unregisteredUserId: null }))).toHaveLength(1);
    });

    it('produces no movements without a user', () => {
        expect(movementsFromEnvelope(requested({ userId: undefined }))).toEqual([]);
    });

    it.each([
        ['a missing allowSenderDebt', { allowSenderDebt: undefined }],
        ['a non-boolean allowSenderDebt', { allowSenderDebt: 'yes' }],
        ['a numeric amount', { amount: 10 }],
        ['an unknown status shape', { status: '' }],
        ['an invalid reverse reference', { reverseParentTransactionId: 'abc' }],
        ['a missing transaction type', { transactionTypeId: undefined }],
    ])('rejects %s', (_name, payload) => {
        expect(() => movementsFromEnvelope(requested(payload))).toThrow(expect.objectContaining({ kind: 'contract' }));
    });

    it('rejects a payload transaction that differs from the envelope', () => {
        const mismatched = parsed(envelope('transaction.microbalances.requested', { transactionId: 300 }, { transactionId: '301' }));

        expect(() => movementsFromEnvelope(mismatched)).toThrow(expect.objectContaining({ kind: 'contract' }));
    });
});

describe('billing.microbalances.requested', () => {
    const billing = (payload: Record<string, unknown> = {}) =>
        parsed(
            envelope('billing.microbalances.requested', {
                transactionId: 400,
                parentTransactionId: 100,
                amount: '3.5',
                transactionTypeId: 3,
                dependsOnTransactionId: 100,
                walletTransferId: 11,
                walletReceiverId: 30,
                createUserId: 8,
                allowSenderDebt: true,
                ...payload,
            }),
        );

    it('maps the child movement with its antecedent', () => {
        expect(movementsFromEnvelope(billing())).toEqual([
            {
                transactionId: 400,
                transactionType: TransactionType.TRANSFER,
                amount: 3.5,
                walletTransferId: 11,
                walletReceiverId: 30,
                hasCreditLine: false,
                allowSenderDebt: true,
                createUserId: 8,
                dependsOnTransactionId: 100,
            },
        ]);
    });

    it('defaults the actor to zero and allows no antecedent', () => {
        const [movement] = movementsFromEnvelope(billing({ createUserId: undefined, dependsOnTransactionId: undefined }));

        expect(movement.createUserId).toBe(0);
        expect(movement.dependsOnTransactionId).toBeUndefined();
    });

    it('tolerates additional payload fields', () => {
        expect(movementsFromEnvelope(billing({ futureField: 1 }))).toHaveLength(1);
    });

    it.each([
        ['a missing receiver wallet', { walletReceiverId: undefined }],
        ['a missing sender wallet', { walletTransferId: undefined }],
        ['a non-decimal amount', { amount: '3,5' }],
        ['a missing allowSenderDebt', { allowSenderDebt: undefined }],
        ['an invalid antecedent', { dependsOnTransactionId: 0 }],
    ])('rejects %s', (_name, payload) => {
        expect(() => movementsFromEnvelope(billing(payload))).toThrow(expect.objectContaining({ kind: 'contract' }));
    });
});
