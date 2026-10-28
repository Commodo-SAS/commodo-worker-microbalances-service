/** Failure families the consumer distinguishes to choose its retry behavior. */
export type MicrobalanceFailureKind = 'contract' | 'rule' | 'dependency';

/** Base of every domain failure; carries a stable code that is safe to log. */
export abstract class MicrobalanceError extends Error {
    abstract readonly kind: MicrobalanceFailureKind;

    /** The error name is the concrete class name, so logs and the processing log identify the failure family. */
    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

/** The event violates its versioned contract; retrying cannot fix it. */
export class MicrobalanceContractError extends MicrobalanceError {
    readonly kind = 'contract';
}

/** A balance rule rejected the movement (missing wallet, insufficient bags, unsupported type). */
export class MicrobalanceRuleError extends MicrobalanceError {
    readonly kind = 'rule';
}

/**
 * The processing time budget ran out while the event was being applied. It is not a MicrobalanceError, so the consumer
 * classifies it as transient: the transaction rolls back and the delivery is retried.
 */
export class MicrobalanceDeadlineExceededError extends Error {
    /** Builds the error with a fixed message and a stable name that is safe to log. */
    constructor() {
        super('The microbalances time budget was exhausted before the event finished');
        this.name = 'MicrobalanceDeadlineExceededError';
    }
}

/** The antecedent of a billing child movement has no microbalances yet; the delivery must be retried later. */
export class MicrobalanceDependencyPendingError extends MicrobalanceError {
    readonly kind = 'dependency';
}
