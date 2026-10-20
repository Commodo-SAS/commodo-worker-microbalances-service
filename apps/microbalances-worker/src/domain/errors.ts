export type MicrobalanceFailureKind = 'contract' | 'rule' | 'dependency';

export abstract class MicrobalanceError extends Error {
    abstract readonly kind: MicrobalanceFailureKind;

    constructor(
        readonly code: string,
        message: string,
    ) {
        super(message);
        this.name = new.target.name;
    }
}

export class MicrobalanceContractError extends MicrobalanceError {
    readonly kind = 'contract';
}

export class MicrobalanceRuleError extends MicrobalanceError {
    readonly kind = 'rule';
}

export class MicrobalanceDependencyPendingError extends MicrobalanceError {
    readonly kind = 'dependency';
}
