import { MicrobalanceContractError } from '../errors/microbalance.errors';
import { MicrobalanceMovement } from '../interfaces/microbalance-movement.interface';
import { TransactionType } from '../enums/transaction-type.enum';

/** Event types published to the microbalances queue. */
export const MICROBALANCE_EVENT_TYPES = [
    'cashback.created',
    'redemption.completed',
    'transaction.microbalances.requested',
    'billing.microbalances.requested',
] as const;

export type MicrobalanceEventType = (typeof MICROBALANCE_EVENT_TYPES)[number];

/** Size budget shared with the producers; larger messages are rejected as contract violations. */
export const MAX_EVENT_BYTES = 200000;

/** Versioned envelope common to every microbalances event; unknown fields are tolerated. */
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

/** Untrusted JSON object read from a message. */
type Dictionary = Record<string, unknown>;

/** True for plain objects; arrays and null are rejected. */
function isObject(value: unknown): value is Dictionary {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** True for safe integers greater than zero, the shape of every persisted identity. */
function positiveId(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}

/** True for decimal strings such as -12.50; amounts travel as strings to keep their exact representation. */
function decimal(value: unknown): value is string {
    return typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
}

/** Producers may omit an optional field or send it as null; both mean absent. */
function absent(value: unknown): boolean {
    return value === undefined || value === null;
}

/**
 * Reads an optional positive identity.
 * @returns The identity, or undefined when absent.
 * @throws MicrobalanceContractError when present but not a positive integer.
 */
function optionalId(source: Dictionary, key: string): number | undefined {
    const value = source[key];
    if (absent(value)) return undefined;
    if (!positiveId(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

/**
 * Reads a required positive identity.
 * @throws MicrobalanceContractError when missing or not a positive integer.
 */
function requiredId(source: Dictionary, key: string): number {
    const value = source[key];
    if (!positiveId(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

/**
 * Reads a required decimal amount, kept as a string.
 * @throws MicrobalanceContractError when missing or not a decimal string.
 */
function requiredDecimal(source: Dictionary, key: string): string {
    const value = source[key];
    if (!decimal(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

/**
 * Reads a required boolean.
 * @throws MicrobalanceContractError when missing or not a boolean.
 */
function requiredBoolean(source: Dictionary, key: string): boolean {
    const value = source[key];
    if (typeof value !== 'boolean') throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

/**
 * Reads an optional short text such as a tracing identifier.
 * @throws MicrobalanceContractError when present but not a string of at most 512 characters.
 */
function optionalText(source: Dictionary, key: string): string | undefined {
    const value = source[key];
    if (absent(value)) return undefined;
    if (typeof value !== 'string' || value.length > 512)
        throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${key}`);
    return value;
}

/**
 * Validates the envelope at consume time. The event id is limited to 64 characters because it is the
 * idempotency key stored in processed_events.
 * @throws MicrobalanceContractError when the envelope is malformed or of an unsupported type or version.
 */
export function parseEnvelope(value: unknown): MicrobalanceEnvelope {
    // The envelope and its payload must be objects before any field is read.
    if (!isObject(value) || !isObject(value.payload)) {
        throw new MicrobalanceContractError('invalid_envelope', 'Invalid microbalance envelope');
    }
    // Only the four versioned events of this queue are accepted.
    if (!MICROBALANCE_EVENT_TYPES.includes(value.eventType as MicrobalanceEventType) || value.version !== 1) {
        throw new MicrobalanceContractError('unsupported_event', 'Unsupported microbalance event type or version');
    }
    // Identity fields are bounded; the event id doubles as the idempotency key.
    for (const key of ['eventId', 'service', 'environment', 'correlationId', 'transactionId']) {
        const field = value[key];
        if (typeof field !== 'string' || !field || field.length > (key === 'eventId' ? 64 : 120)) {
            throw new MicrobalanceContractError('invalid_envelope', `Invalid microbalance envelope field: ${key}`);
        }
    }
    // occurredAt must be a parseable timestamp.
    if (typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt))) {
        throw new MicrobalanceContractError('invalid_envelope', 'Invalid microbalance envelope field: occurredAt');
    }
    // Copy only the known fields; additional fields from newer producers are ignored.
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

/** Fields of a transaction snapshot that the microbalance rules use; the rest of the producer snapshot is ignored. */
interface TransactionSnapshot {
    transactionId: number;
    transactionTypeId: number;
    status: string;
    amount: string;
    walletTransferId?: number;
    walletReceiverId?: number;
    creditLineId?: number;
}

/**
 * Validates one transaction snapshot of a cashback or redemption event.
 * @throws MicrobalanceContractError when a field violates the contract.
 */
function parseSnapshot(value: unknown, field: string): TransactionSnapshot {
    if (!isObject(value)) throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${field}`);
    if (typeof value.status !== 'string' || !value.status) {
        throw new MicrobalanceContractError('invalid_field', `Invalid microbalance event field: ${field}.status`);
    }
    // Fields the rules do not use are still validated, so a corrupt snapshot is rejected early.
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

/** The registered user of the operation; its absence means the legacy consumer created no microbalances. */
function optionalUserId(payload: Dictionary): number | undefined {
    return optionalId(payload, 'userId');
}

/**
 * Maps cashback.created and redemption.completed to the movements of the partner and the optional wholesaler.
 * @throws MicrobalanceContractError when the payload violates the contract.
 */
function loyaltyMovements(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    const payload = envelope.payload;
    const isRedemption = envelope.eventType === 'redemption.completed';
    // Only COMMODO movements are supported.
    if (payload.currency !== 'COMMODO') throw new MicrobalanceContractError('invalid_field', 'Invalid microbalance event field: currency');

    // The partner leg defines the transaction type; cashbacks and redemptions accept different types and statuses.
    const partner = parseSnapshot(payload.transaction, 'transaction');
    if (isRedemption && (partner.transactionTypeId !== TransactionType.REDEMPTION || partner.status !== 'TRANSCONFIRMED')) {
        throw new MicrobalanceContractError('invalid_field', 'Invalid redemption transaction snapshot');
    }
    if (!isRedemption && (partner.transactionTypeId !== TransactionType.CASHBACK || !['TRANSCONFIRMED', 'TRANSPENDING'].includes(partner.status))) {
        throw new MicrobalanceContractError('invalid_field', 'Invalid cashback transaction snapshot');
    }
    // The snapshot must describe the transaction the envelope refers to.
    if (String(partner.transactionId) !== envelope.transactionId) {
        throw new MicrobalanceContractError('invalid_field', 'Transaction identity does not match the envelope');
    }
    // The wholesaler leg is optional and independent of the partner leg.
    const wholesaler = absent(payload.wholesalerTransaction) ? undefined : parseSnapshot(payload.wholesalerTransaction, 'wholesalerTransaction');
    const userId = optionalUserId(payload);
    // The producer does not send allowSenderDebt yet; the legacy default was false.
    const allowSenderDebt = payload.allowSenderDebt === true;

    // Without a registered user the legacy consumer created no microbalances.
    if (!userId) return [];

    // Both legs use the partner transaction type and redemptions always use REDEMPTION (legacy behavior).
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

/**
 * Maps transaction.microbalances.requested to its single movement.
 * @throws MicrobalanceContractError when the payload violates the contract.
 */
function transactionRequestMovements(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    const payload = envelope.payload;
    // The payload transaction must be the one the envelope refers to.
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

    // Without a registered user no microbalances are created.
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

/**
 * Maps billing.microbalances.requested to the tax or commission movement billing generated.
 * @throws MicrobalanceContractError when the payload violates the contract.
 */
function billingMovements(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    const payload = envelope.payload;
    // The payload transaction must be the one the envelope refers to.
    const transactionId = requiredId(payload, 'transactionId');
    if (String(transactionId) !== envelope.transactionId) {
        throw new MicrobalanceContractError('invalid_field', 'Transaction identity does not match the envelope');
    }
    // The parent is not used for balances but must be well formed when present.
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
            // The antecedent whose microbalances must exist first: principal, then tax, then commission.
            dependsOnTransactionId: optionalId(payload, 'dependsOnTransactionId'),
        },
    ];
}

/**
 * Validates the payload of the event and maps it to the movements to apply. Returns no movements when the event
 * has no registered user, as the legacy consumer skipped those. Cashback and redemption keep the legacy rules:
 * both legs use the partner transaction type, redemptions force REDEMPTION and sender debt defaults to false
 * unless the producer sends allowSenderDebt.
 * @throws MicrobalanceContractError when the payload violates the event contract.
 */
export function movementsFromEnvelope(envelope: MicrobalanceEnvelope): MicrobalanceMovement[] {
    // Each event type has its own payload contract.
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
