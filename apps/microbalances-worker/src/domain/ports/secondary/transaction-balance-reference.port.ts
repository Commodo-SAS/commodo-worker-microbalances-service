/** Link between a movement and the bag amount it drew from or covered. */
export interface BalanceReferenceRecord {
    id: number;
    transactionId: number;
    walletBalanceId: number;
    amountUsed: number;
}

/** Data needed to record a movement-to-bag reference. */
export interface CreateBalanceReferenceInput {
    transactionId: number;
    walletBalanceId: number;
    amountUsed: number;
    createdBy: number;
}

/** Persistence of movement-to-bag references inside the active database transaction. */
export interface BalanceReferencePort {
    /** Records that a movement used or covered part of a bag. */
    create(input: CreateBalanceReferenceInput): Promise<void>;
    /** All references of a movement; their existence proves it was already applied. */
    findAllByTransactionId(transactionId: number): Promise<BalanceReferenceRecord[]>;
}
