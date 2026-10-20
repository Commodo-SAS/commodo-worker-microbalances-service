import { Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from './transformers';

@Entity({ name: 'wallets', schema: 'public' })
export class WalletRow {
    @PrimaryColumn('bigint', { transformer: bigintTransformer })
    id: number;
}
