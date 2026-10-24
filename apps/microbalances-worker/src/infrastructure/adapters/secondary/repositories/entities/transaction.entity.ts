import { Column, Entity, PrimaryColumn } from 'typeorm';
import { balanceTransformer, bigintTransformer } from './transformers';

/** Minimal mapping of transactions: only what is needed to decide whether an antecedent is settled. */
@Entity({ name: 'transactions', schema: 'public' })
export class TransactionRow {
    @PrimaryColumn('bigint', { transformer: bigintTransformer })
    id: number;

    @Column({ type: 'decimal', precision: 20, scale: 8, transformer: balanceTransformer })
    amount: number;

    @Column({ type: 'integer', name: 'unregistered_user_id', nullable: true })
    unregisteredUserId?: number;
}
