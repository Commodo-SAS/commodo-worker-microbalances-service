import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { setupApp } from '@commodo-sas/shared-libs/core/core/bootstrap/bootstrap-app';
import { CommodoLoggerService } from '@commodo-sas/shared-libs/observability';
import { MicrobalancesWorkerModule } from './microbalances-worker.module';
import { MicrobalancesEnvironmentUtils } from './infrastructure/environment/microbalances-environment.utils';

/**
 * Boots the worker. The HTTP listener exists only for the shared liveness endpoint; the SQS consumer starts
 * with the module and stops through the Nest shutdown hooks.
 */
async function bootstrap(): Promise<void> {
    // An HTTP app is created because setupApp configures the shared liveness endpoint; the work itself is done by the SQS consumer.
    const app = await NestFactory.create(MicrobalancesWorkerModule, { bufferLogs: true });
    app.useLogger(app.get(CommodoLoggerService));
    app.enableShutdownHooks();

    // Shared bootstrap: liveness endpoint, interceptors and prefix, as in every other service.
    setupApp(app, {
        healthCheck: true,
        logger: { enabled: false },
        xray: { enabled: false, appName: 'commodo-worker-microbalances' },
        routeNormalization: { collapseDoubleSlashes: true },
        bogotaTimezoneInterceptor: true,
        allExceptionsFilter: false,
        responseInterceptor: true,
    });

    // The port comes from the repository EnvironmentUtils, never from process.env.
    await app.listen(app.get(MicrobalancesEnvironmentUtils).getMicrobalancesServerPort());
}

bootstrap().catch((error: unknown) => {
    console.error(
        JSON.stringify({
            event: 'microbalances.bootstrap.failed',
            outcome: 'failure',
            error: {
                name: error instanceof Error ? error.name : 'unknown',
                message: error instanceof Error ? error.message.slice(0, 300) : undefined,
            },
        }),
    );
    // Report the failure without payloads or secrets and let the orchestrator restart the container.
    process.exitCode = 1;
});
