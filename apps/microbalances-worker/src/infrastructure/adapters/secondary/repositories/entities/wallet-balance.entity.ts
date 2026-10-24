import { Column, Entity } from 'typeorm';
import { WalletBalanceStatus } from '../../../../../domain/enums/transaction-type.enum';
import { RowBase } from './row-base';
import { balanceTransformer } from './transformers';

/** Wallet bag (microbalance). Amounts use the legacy float transformer so arithmetic matches the previous consumer. */
@Entity({ name: 'wallet_balances', schema: 'public' })
export class WalletBalanceRow extends RowBase {
    @Column({ type: 'decimal', precision: 20, scale: 8, name: 'original_amount', nullable: false, transformer: balanceTransformer })
    originalAmount: number;

    @Column({ type: 'decimal', precision: 20, scale: 8, name: 'available_amount', nullable: true, transformer: balanceTransformer })
    availableAmount: number;

    @Column({ type: 'enum', enum: WalletBalanceStatus, default: WalletBalanceStatus.AVAILABLE, name: 'balance_status' })
    balanceStatus: WalletBalanceStatus;

    @Column({ type: 'timestamp', nullable: true, name: 'expiration_date' })
    expirationDate?: Date;

    @Column({ name: 'wallet_id' })
    walletId: number;

    @Column({ name: 'transaction_id' })
    transactionId: number;
}
