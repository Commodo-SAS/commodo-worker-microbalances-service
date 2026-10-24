import { Column, Entity } from 'typeorm';
import { RowBase } from './row-base';
import { balanceTransformer } from './transformers';

/** Link between a movement and the bag amount it drew or covered; also the legacy proof that a movement was applied. */
@Entity({ name: 'transaction_balance_reference', schema: 'public' })
export class TransactionBalanceReferenceRow extends RowBase {
    @Column({ type: 'decimal', precision: 20, scale: 8, name: 'amount_used', nullable: false, transformer: balanceTransformer })
    amountUsed: number;

    @Column({ type: 'integer', name: 'transaction_id', nullable: false })
    transactionId: number;

    @Column({ type: 'integer', name: 'wallet_balance_id', nullable: false })
    walletBalanceId: number;
}
