import { MicrobalanceContractError } from './errors';
import { MicrobalanceMovement } from './movement';
import { TransactionType } from './transaction-type';

export const MICROBALANCE_EVENT_TYPES = [
    'cashback.created',
    'redemption.completed',
    'transaction.microbalances.requested',
    'billing.microbalances.requested',
] as const;

export type MicrobalanceEventType = (typeof MICROBALANCE_EVENT_TYPES)[number];

export const MAX_EVENT_BYTES = 200000;

export interface MicrobalanceEnvelope {
    eventId: string;
    eventType: MicrobalanceEventType;
    version: 1;
    occurredAt: string;
    service: string;
    environment: string;
    correlationId: string;
    transactionId: string;
    requestId?: string;
    traceId?: string;
    traceparent?: string;
    tracestate?: string;
    payload: Record<string, unknown>;
}

type Dictionary = Record<string, unknown>;

function isObject(value: unknown): value is Dictionary {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveId(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

function decimal(value: unknown): value is string {
    return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
}

function absent(value: unknown): boolean {
    return value === undefined || value === null;
}

function optionalId(source: Dictionary, key: string): number | undefined {
    const value = source[key];
    if (absent(value)) return undefined;
    if (!positiveId(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

function requiredId(source: Dictionary, key: string): number {
    const value = source[key];
    if (!positiveId(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

function requiredDecimal(source: Dictionary, key: string): string {
    const value = source[key];
    if (!decimal(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

function requiredBoolean(source: Dictionary, key: string): boolean {
    const value = source[key];
    if (typeof value !== 'boolean') throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

function optionalText(source: Dictionary, key: string): string | undefined {
    const value = source[key];
    if (absent(value)) return undefined;
    if (typeof value !== 'string' || value.length > 512) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

export function parseEnvelope(value: unknown): MicrobalanceEnvelope {
    if (!isObject(value) || !isObject(value.payload)) {
        throw new MicrobalanceContractError('invalid_envelope', 'Invalid microbalance envelope');
    }
    if (!MICROBALANCE_EVENT_TYPES.includes(value.eventType as MicrobalanceEventType) || value.version !== 1) {
        throw new MicrobalanceContractError('unsupported_event', 'Unsupported microbalance event type or version');
    }
    for (const key of ['eventId', 'service', 'environment', 'correlationId', 'transactionId']) {
        const field = value[key];
        if (typeof field !== 'string' || !field || field.length > (key === 'eventId' ? 64 : 120)) {
            throw new MicrobalanceContractError('invalid_envelope', `Invalid microbalance envelope field: ${key}`);
        }
    }
    if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))) {
        throw new MicrobalanceContractError('invalid_envelope', 'Invalid microbalance envelope field: occurredAt');
    }
    return {
        eventId: value.eventId as string,
        eventType: value.eventType as MicrobalanceEventType,
        version: 1,
        occurredAt: value.occurredAt,
        service: value.service as string,
        environment: value.environment as string,
        correlationId: value.correlationId as string,
        transactionId: value.transactionId as string,
        requestId: optionalText(value, 'requestId'),
        traceId: optionalText(value, 'traceId'),
        traceparent: optionalText(value, 'traceparent'),
        tracestate: optionalText(value, 'tracestate'),
        payload: value.payload,
    };
}

interface TransactionSnapshot {
    transactionId: number;
    transactionTypeId: number;
    status: string;
    amount: string;
    walletTransferId?: number;
    walletReceiverId?: number;
    creditLineId?: number;
}

function parseSnapshot(value: unknown, field: string): TransactionSnapshot {
    if (!isObject(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${field}`);
    if (typeof value.status !== 'string' || !value.status) {
        throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${field}.status`);
    }
    requiredId(value, 'partnerId');
    for (const key of ['branchId', 'parentTransactionId', 'unregisteredUserId']) optionalId(value, key);
    for (const key of ['baseAmount', 'purchaseAmount']) {
        if (!absent(value[key]) && !decimal(value[key])) {
            throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${field}.${key}`);
        }
    }
    return {
        transactionId: requiredId(value, 'transactionId'),
        transactionTypeId: requiredId(value, 'transactionTypeId'),
        status: value.status,
        amount: requiredDecimal(value, 'amount'),
        walletTransferId: optionalId(value, 'walletTransferId'),
        walletReceiverId: optionalId(value, 'walletReceiverId'),
        creditLineId: optionalId(value, 'creditLineId'),
    };
}

function optionalUserId(payload: Dictionary): number | undefined {
    return optionalId(payload, 'userId');
}

function loyaltyMovements(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    const payload = envelope.payload;
    const isRedemption = envelope.eventType === 'redemption.completed';
    if (payload.currency !== 'COMMODO') throw new MicrobalanceContractError('invalid_field', 'Invalid microbalance event field: currency');

    const partner = parseSnapshot(payload.transaction, 'transaction');
    if (isRedemption && (partner.transactionTypeId !== TransactionType.REDEMPTION || partner.status !== 'TRANSCONFIRMED')) {
        throw new MicrobalanceContractError('invalid_field', 'Invalid redemption transaction snapshot');
    }
    if (!isRedemption && (partner.transactionTypeId !== TransactionType.CASHBACK || !['TRANSCONFIRMED', 'TRANSPENDING'].includes(partner.status))) {
        throw new MicrobalanceContractError('invalid_field', 'Invalid cashback transaction snapshot');
    }
    if (String(partner.transactionId) !== envelope.transactionId) {
        throw new MicrobalanceContractError('invalid_field', 'Transaction identity does not match the envelope');
    }
    const wholesaler = absent(payload.wholesalerTransaction) ? undefined : parseSnapshot(payload.wholesalerTransaction, 'wholesalerTransaction');
    const userId = optionalUserId(payload);
    const allowSenderDebt = payload.allowSenderDebt === true;

    if (!userId) return [];

    return [partner, ...(wholesaler ? [wholesaler] : [])].map((leg) => ({
        transactionId: leg.transactionId,
        transactionType: isRedemption ? TransactionType.REDEMPTION : partner.transactionTypeId,
        amount: Number(leg.amount),
        walletTransferId: leg.walletTransferId,
        walletReceiverId: leg.walletReceiverId,
        hasCreditLine: !!leg.creditLineId,
        allowSenderDebt,
        createUserId: userId,
    }));
}

function transactionRequestMovements(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    const payload = envelope.payload;
    const transactionId = requiredId(payload, 'transactionId');
    if (String(transactionId) !== envelope.transactionId) {
        throw new MicrobalanceContractError('invalid_field', 'Transaction identity does not match the envelope');
    }
    const transactionTypeId = requiredId(payload, 'transactionTypeId');
    if (typeof payload.status !== 'string' || !payload.status) {
        throw new MicrobalanceContractError('invalid_field', 'Invalid microbalance event field: status');
    }
    const amount = requiredDecimal(payload, 'amount');
    const allowSenderDebt = requiredBoolean(payload, 'allowSenderDebt');
    const userId = optionalUserId(payload);
    const walletTransferId = optionalId(payload, 'walletTransferId');
    const walletReceiverId = optionalId(payload, 'walletReceiverId');
    const creditLineId = optionalId(payload, 'creditLineId');
    const reverseParentTransactionId = optionalId(payload, 'reverseParentTransactionId');
    for (const key of ['parentTransactionId', 'unregisteredUserId']) optionalId(payload, key);

    if (!userId) return [];

    return [
        {
            transactionId,
            transactionType: transactionTypeId,
            amount: Number(amount),
            walletTransferId,
            walletReceiverId,
            hasCreditLine: !!creditLineId,
            reverseParentTransactionId,
            allowSenderDebt,
            createUserId: userId,
        },
    ];
}

function billingMovements(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    const payload = envelope.payload;
    const transactionId = requiredId(payload, 'transactionId');
    if (String(transactionId) !== envelope.transactionId) {
        throw new MicrobalanceContractError('invalid_field', 'Transaction identity does not match the envelope');
    }
    optionalId(payload, 'parentTransactionId');
    return [
        {
            transactionId,
            transactionType: requiredId(payload, 'transactionTypeId'),
            amount: Number(requiredDecimal(payload, 'amount')),
            walletTransferId: requiredId(payload, 'walletTransferId'),
            walletReceiverId: requiredId(payload, 'walletReceiverId'),
            hasCreditLine: false,
            allowSenderDebt: requiredBoolean(payload, 'allowSenderDebt'),
            createUserId: optionalId(payload, 'createUserId') ?? 0,
            dependsOnTransactionId: optionalId(payload, 'dependsOnTransactionId'),
        },
    ];
}

export function movementsFromEnvelope(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    switch (envelope.eventType) {
        case 'cashback.created':
        case 'redemption.completed':
            return loyaltyMovements(envelope);
        case 'transaction.microbalances.requested':
            return transactionRequestMovements(envelope);
        case 'billing.microbalances.requested':
            return billingMovements(envelope);
    }
}
