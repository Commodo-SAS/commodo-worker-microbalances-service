import { DataSource } from 'typeorm';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { EventProcessingLogEntity, ProcessedEventEntity } from '@commodo-sas/shared-libs/sqs';
import { MicrobalancesEnvironmentUtils, MicrobalancesWorkerConfiguration } from './environment/microbalances-environment.utils';
import { TransactionBalanceReferenceRow } from './persistence/transaction-balance-reference.entity';
import { TransactionRow } from './persistence/transaction.entity';
import { WalletBalanceRow } from './persistence/wallet-balance.entity';
import { WalletRow } from './persistence/wallet.entity';

export const MICROBALANCES_CONFIG = Symbol('MICROBALANCES_CONFIG');

export function workerConfig(environmentUtils: MicrobalancesEnvironmentUtils): MicrobalancesWorkerConfiguration {
    return environmentUtils.getMicrobalancesWorkerConfiguration();
}

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
        // eslint-disable-next-line @typescript-eslint/naming-convention -- node-postgres native option names.
        extra: { max: config.concurrency + 2, connectionTimeoutMillis: 5000, idle_in_transaction_session_timeout: config.dbStatementTimeoutMs * 2 },
    });
}
