import { Module } from '@nestjs/common';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { ObservabilityModule } from '@commodo-sas/shared-libs/observability';
import { MicrobalancesEnvironmentModule } from './infrastructure/environment/microbalances-environment.module';
import { MicrobalancesModule } from './microbalances.module';

/** Application module of the worker: repository environment, observability and the microbalances feature module. */
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
                requestAudit: { enabled: true, includeRequestPayload: true, includeResponseBody: true },
                tracing: { enabled: false },
            }),
        }),
        MicrobalancesModule,
    ],
})
export class MicrobalancesWorkerModule {}
