import { Entity, PrimaryColumn } from 'typeorm';
import { bigintTransformer } from './transformers';

/** Minimal mapping of wallets: the worker only locks wallet rows and checks that they exist. */
@Entity({ name: 'wallets', schema: 'public' })
export class WalletRow {
    @PrimaryColumn('bigint', { transformer: bigintTransformer })
    id: number;
}
