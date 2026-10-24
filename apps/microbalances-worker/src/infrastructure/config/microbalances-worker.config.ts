import { DataSource } from 'typeorm';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { EventProcessingLogEntity, ProcessedEventEntity } from '@commodo-sas/shared-libs/sqs';
import { MicrobalancesEnvironmentUtils, MicrobalancesWorkerConfiguration } from '../environment/microbalances-environment.utils';
import { TransactionBalanceReferenceRow } from '../adapters/secondary/repositories/entities/transaction-balance-reference.entity';
import { TransactionRow } from '../adapters/secondary/repositories/entities/transaction.entity';
import { WalletBalanceRow } from '../adapters/secondary/repositories/entities/wallet-balance.entity';
import { WalletRow } from '../adapters/secondary/repositories/entities/wallet.entity';

/** Injection token for the validated worker configuration. */
export const MICROBALANCES_CONFIG = Symbol('MICROBALANCES_CONFIG');

/** Resolves the worker configuration through the repository EnvironmentUtils. */
export function workerConfig(environmentUtils: MicrobalancesEnvironmentUtils): MicrobalancesWorkerConfiguration {
    return environmentUtils.getMicrobalancesWorkerConfiguration();
}

/**
 * Builds the PostgreSQL data source without initializing it, so a disabled worker never opens a connection.
 * The pool is sized for the consumer concurrency plus the processing log writes; schema synchronization and
 * migrations stay off because the tables belong to other services.
 */
export function database(environmentUtils: EnvironmentUtils, config: MicrobalancesWorkerConfiguration): DataSource {
    const db = environmentUtils.getDbConfig('default');
    return new DataSource({
        type: 'postgres',
        host: db.host,
        port: Number(db.port),
        username: db.user,
        password: db.password,
        database: db.database,
        entities: [WalletRow, WalletBalanceRow, TransactionBalanceReferenceRow, TransactionRow, EventProcessingLogEntity, ProcessedEventEntity],
        synchronize: false,
        migrationsRun: false,
        extra: { max: config.concurrency + 2, connectionTimeoutMillis: 5000, idle_in_transaction_session_timeout: config.dbStatementTimeoutMs * 2 },
    });
}
