import { BalanceReferencePort } from './transaction-balance-reference.port';
import { WalletBalancePort } from './wallet-balance.port';

/** Persistence the balance rules need, bound to one database transaction. */
export interface BalanceUnit {
    walletBalances: WalletBalancePort;
    references: BalanceReferencePort;
}

/**
 * Persistence operations available inside one microbalances database transaction.
 * Every method shares the transaction that also holds the idempotency claim.
 */
export interface MicrobalanceUnit extends BalanceUnit {
    /**
     * Claims the event for this consumer inside the active transaction.
     * @param eventId - Stable event identity used as the idempotency key.
     * @param eventType - Versioned event type recorded with the claim.
     * @returns True when this delivery owns the event; false when it was already processed.
     */
    claimEvent(eventId: string, eventType: string): Promise<boolean>;
    /**
     * Locks the wallets for update in a stable order so concurrent movements on the same wallet are serialized.
     * @param walletIds - Wallet identities to lock.
     * @returns The identities that exist; a missing wallet is simply absent from the result.
     */
    lockWallets(walletIds: number[]): Promise<number[]>;
    /**
     * Detects a movement that already has microbalances, whichever event delivered it.
     * @param transactionId - Business transaction of the movement.
     * @param walletReceiverId - Receiver wallet whose bags would have been created, when there is one.
     */
    isMovementApplied(transactionId: number, walletReceiverId?: number): Promise<boolean>;
    /**
     * Decides whether the antecedent of a billing child movement no longer blocks it.
     * Settled means it has references or bags, belongs to an unregistered user (never processed by the legacy logic)
     * or has a zero amount (produces no bags).
     * @param transactionId - Antecedent business transaction.
     */
    isAntecedentSettled(transactionId: number): Promise<boolean>;
}

/** Time budget for one transaction attempt chain. */
export interface MicrobalanceTransactionOptions {
    /** Absolute epoch milliseconds after which no further retry may start. */
    deadlineAt: number;
}

/**
 * Runs microbalance work atomically; the implementation owns commit, rollback and transient retries.
 * It is an abstract class so Nest uses it as the injection token, like the ports of the reference module.
 */
export abstract class MicrobalanceStore {
    /**
     * Executes the work in one transaction and commits only when it resolves.
     * @param work - Callback receiving the transaction-bound unit; throwing rolls everything back.
     * @param options - Time budget shared by all retry attempts.
     */
    abstract transaction<T>(work: (unit: MicrobalanceUnit) => Promise<T>, options: MicrobalanceTransactionOptions): Promise<T>;
}
