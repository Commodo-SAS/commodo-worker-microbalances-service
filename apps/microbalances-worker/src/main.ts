import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { CommodoLoggerService } from '@commodo-sas/shared-libs/observability';
import { MicrobalancesWorkerModule } from './microbalances-worker.module';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.createApplicationContext(MicrobalancesWorkerModule, { bufferLogs: true });
    app.useLogger(app.get(CommodoLoggerService));
    app.enableShutdownHooks();
}

bootstrap().catch(() => {
    console.error(JSON.stringify({ event: 'microbalances.bootstrap.failed', outcome: 'failure' }));
    process.exitCode = 1;
});
