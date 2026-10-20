import { BalanceUnit } from '../../domain/ports/balance-unit';

export interface MicrobalanceUnit extends BalanceUnit {
    claimEvent(eventId: string, eventType: string): Promise<boolean>;
    lockWallets(walletIds: number[]): Promise<number[]>;
    isMovementApplied(transactionId: number, walletReceiverId?: number): Promise<boolean>;
    isAntecedentSettled(transactionId: number): Promise<boolean>;
}

export interface MicrobalanceTransactionOptions {
    deadlineAt: number;
}

export abstract class MicrobalanceStore {
    abstract transaction<T>(work: (unit: MicrobalanceUnit) => Promise<T>, options: MicrobalanceTransactionOptions): Promise<T>;
}
