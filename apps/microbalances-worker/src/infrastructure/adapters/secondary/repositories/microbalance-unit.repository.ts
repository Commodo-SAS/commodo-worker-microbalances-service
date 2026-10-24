import { EntityManager } from 'typeorm';
import { markProcessed } from '@commodo-sas/shared-libs/sqs';
import { MicrobalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { BalanceReferencePort } from '../../../../domain/ports/secondary/transaction-balance-reference.port';
import { WalletBalancePort } from '../../../../domain/ports/secondary/wallet-balance.port';
import { TransactionBalanceReferenceRow } from './entities/transaction-balance-reference.entity';
import { TransactionRow } from './entities/transaction.entity';
import { WalletBalanceRow } from './entities/wallet-balance.entity';
import { WalletRow } from './entities/wallet.entity';
import { TransactionBalanceReferenceRepository } from './transaction-balance-reference.repository';
import { WalletBalanceRepository } from './wallet-balance.repository';

/** Stable consumer name scoping this worker idempotency marks in processed_events; shared by all replicas. */
export const MICROBALANCES_CONSUMER = 'microbalances';

/**
 * Transaction-bound persistence built on entities, as the legacy repositories were. Raw SQL is avoided except in
 * the shared-libs markProcessed helper.
 */
export class MicrobalanceUnitRepository implements MicrobalanceUnit {
    readonly walletBalances: WalletBalancePort;
    readonly references: BalanceReferencePort;

    constructor(private readonly manager: EntityManager) {
        this.walletBalances = new WalletBalanceRepository(manager);
        this.references = new TransactionBalanceReferenceRepository(manager);
    }

    /** Claims the event for this consumer inside the active transaction (shared-libs markProcessed). */
    claimEvent(eventId: string, eventType: string): Promise<boolean> {
        return markProcessed(this.manager, { consumer: MICROBALANCES_CONSUMER, eventId, eventType });
    }

    /** Pessimistic write lock ordered by id, so movements touching the same wallets serialize without deadlocking. */
    async lockWallets(walletIds: number[]): Promise<number[]> {
        // Nothing to lock for movements without wallets.
        if (walletIds.length === 0) return [];
        const wallets = await this.manager
            .createQueryBuilder(WalletRow, 'wallet')
            .setLock('pessimistic_write')
            .where('wallet.id IN (:...walletIds)', { walletIds })
            .orderBy('wallet.id', 'ASC')
            .getMany();
        return wallets.map((wallet) => wallet.id);
    }

    /** Same check as the legacy consumer: references for the movement or bags of its receiver wallet. */
    async isMovementApplied(transactionId: number, walletReceiverId?: number): Promise<boolean> {
        if (await this.manager.exists(TransactionBalanceReferenceRow, { where: { transactionId } })) return true;
        // Without a receiver wallet only references can prove the movement was applied.
        if (!walletReceiverId) return false;
        return this.manager.exists(WalletBalanceRow, { where: { transactionId, walletId: walletReceiverId } });
    }

    /** An unregistered-user or zero-amount antecedent produces no bags, so it must not block its children. */
    async isAntecedentSettled(transactionId: number): Promise<boolean> {
        if (await this.manager.exists(TransactionBalanceReferenceRow, { where: { transactionId } })) return true;
        if (await this.manager.exists(WalletBalanceRow, { where: { transactionId } })) return true;
        // Last resort: transactions that never produce bags settle their children.
        const transaction = await this.manager.findOne(TransactionRow, { where: { id: transactionId } });
        return !!transaction && (!!transaction.unregisteredUserId || Number(transaction.amount) === 0);
    }
}
