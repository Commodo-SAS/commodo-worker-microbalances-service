import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { ObservabilityModule } from '@commodo-sas/shared-libs/observability';
import { ApplyMicrobalances } from './application/apply-microbalances.use-case';
import { MicrobalanceStore } from './application/ports/microbalance-store.port';
import { MICROBALANCES_CONFIG, database, workerConfig } from './infrastructure/config';
import { MicrobalancesEnvironmentModule } from './infrastructure/environment/microbalances-environment.module';
import { MicrobalancesEnvironmentUtils } from './infrastructure/environment/microbalances-environment.utils';
import { PostgresMicrobalanceStore } from './infrastructure/persistence/postgres-microbalance-store';
import { microbalancesSqsClientProvider } from './infrastructure/sqs/microbalances-sqs.client';
import { MicrobalancesSqsConsumer } from './infrastructure/sqs/microbalances-sqs.consumer';

@Module({
    imports: [
        MicrobalancesEnvironmentModule,
        ObservabilityModule.forRootAsync({
            imports: [MicrobalancesEnvironmentModule],
            inject: [EnvironmentUtils],
            useFactory: (environmentUtils: EnvironmentUtils) => ({
                serviceName: 'commodo-worker-microbalances-service',
                environment: environmentUtils.getEnv(),
                version: '0.0.1',
                logLevel: 'info',
                requestAudit: { enabled: false, includeRequestPayload: false, includeResponseBody: false },
                tracing: { enabled: false },
            }),
        }),
    ],
    providers: [
        { provide: MICROBALANCES_CONFIG, useFactory: workerConfig, inject: [MicrobalancesEnvironmentUtils] },
        { provide: DataSource, useFactory: database, inject: [EnvironmentUtils, MICROBALANCES_CONFIG] },
        microbalancesSqsClientProvider,
        PostgresMicrobalanceStore,
        { provide: MicrobalanceStore, useExisting: PostgresMicrobalanceStore },
        ApplyMicrobalances,
        MicrobalancesSqsConsumer,
    ],
})
export class MicrobalancesWorkerModule {}
