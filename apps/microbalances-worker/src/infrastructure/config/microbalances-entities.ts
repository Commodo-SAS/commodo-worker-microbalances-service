import { EventProcessingLogEntity, ProcessedEventEntity } from '@commodo-sas/shared-libs/sqs';
import { TransactionBalanceReferenceRow } from '../adapters/secondary/repositories/entities/transaction-balance-reference.entity';
import { TransactionRow } from '../adapters/secondary/repositories/entities/transaction.entity';
import { WalletBalanceRow } from '../adapters/secondary/repositories/entities/wallet-balance.entity';
import { WalletRow } from '../adapters/secondary/repositories/entities/wallet.entity';

/**
 * Entities registered on the default connection. The tables belong to other services, so schema synchronization and
 * migrations stay off (DBManagmentModule forces both to false).
 */
export const MICROBALANCES_DEFAULT_ENTITIES = [
    WalletRow,
    WalletBalanceRow,
    TransactionBalanceReferenceRow,
    TransactionRow,
    EventProcessingLogEntity,
    ProcessedEventEntity,
];
