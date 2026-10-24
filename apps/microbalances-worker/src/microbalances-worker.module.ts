import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { ObservabilityModule } from '@commodo-sas/shared-libs/observability';
import { ApplyMicrobalancesService } from './application/use-cases/apply-microbalances/apply-microbalances.service';
import { MICROBALANCE_STORE } from './domain/ports/secondary/microbalance-store.port';
import { MICROBALANCES_CONFIG, database, workerConfig } from './infrastructure/config/microbalances-worker.config';
import { MicrobalancesEnvironmentModule } from './infrastructure/environment/microbalances-environment.module';
import { MicrobalancesEnvironmentUtils } from './infrastructure/environment/microbalances-environment.utils';
import { MicrobalanceStoreRepository } from './infrastructure/adapters/secondary/repositories/microbalance-store.repository';
import { microbalancesSqsClientProvider } from './infrastructure/adapters/secondary/sqs/microbalances-sqs.client';
import { MicrobalancesSqsConsumer } from './infrastructure/adapters/primary/sqs/microbalances-sqs.consumer';

/** Composition root: binds the store port to PostgreSQL and starts the SQS consumer with the module. */
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
        MicrobalanceStoreRepository,
        { provide: MICROBALANCE_STORE, useExisting: MicrobalanceStoreRepository },
        ApplyMicrobalancesService,
        MicrobalancesSqsConsumer,
    ],
})
export class MicrobalancesWorkerModule {}
