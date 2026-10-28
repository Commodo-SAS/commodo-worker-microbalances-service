import { EntityManager } from 'typeorm';
import {
    BalanceReferencePort,
    BalanceReferenceRecord,
    CreateBalanceReferenceInput,
} from '../../../../domain/ports/secondary/transaction-balance-reference.port';
import { TransactionBalanceReferenceRow } from './entities/transaction-balance-reference.entity';

/** Movement-to-bag references persisted through the entity manager of the active transaction. */
export class TransactionBalanceReferenceRepository implements BalanceReferencePort {
    /** @param manager - Entity manager of the active transaction. */
    constructor(private readonly manager: EntityManager) {}

    /** Persists a reference between a movement and a bag. */
    async create(input: CreateBalanceReferenceInput): Promise<void> {
        const reference = this.manager.create(TransactionBalanceReferenceRow, input);
        await this.manager.save(TransactionBalanceReferenceRow, reference);
    }

    /** All references of a movement; their existence proves it was already applied. */
    async findAllByTransactionId(transactionId: number): Promise<BalanceReferenceRecord[]> {
        const rows = await this.manager.find(TransactionBalanceReferenceRow, { where: { transactionId } });
        return rows.map((row) => ({
            id: row.id,
            transactionId: row.transactionId,
            walletBalanceId: row.walletBalanceId,
            amountUsed: row.amountUsed,
        }));
    }
}
