import { SQSClient } from '@aws-sdk/client-sqs';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { EDatabaseConfig } from '@commodo-sas/shared-libs/core/core/enums/database-config.enum';
import { ApplyMicrobalancesService } from './application';
import { MicrobalanceStore } from './domain/ports';
import { MicrobalancesSqsConsumer } from './infrastructure/adapters/primary/sqs';
import { MicrobalanceStoreRepository } from './infrastructure/adapters/secondary/repositories';
import { MicrobalancesModule } from './microbalances.module';

const mockDataSource = { options: { extra: { max: 10 } }, isInitialized: true };
const mockRuntimeLog = jest.fn();

// Stands in for the shared connection module so no database is opened; it provides the token the adapters inject.
jest.mock('@commodo-sas/shared-libs/db-managment/db-managment-connections.module', () => {
    const common = jest.requireActual('@nestjs/common');
    const typeorm = jest.requireActual('@nestjs/typeorm');
    class FakeConnectionsModule {}
    common.Global()(FakeConnectionsModule);
    common.Module({})(FakeConnectionsModule);
    return {
        DBManagmentConnectionsModule: {
            forRoot: () => ({
                module: FakeConnectionsModule,
                providers: [{ provide: typeorm.getDataSourceToken('default'), useFactory: () => mockDataSource }],
                exports: [typeorm.getDataSourceToken('default')],
            }),
        },
    };
});

// Replaces the secrets-loading module with doubles for the environment and the observability services.
jest.mock('./infrastructure/environment/microbalances-environment.module', () => {
    const common = jest.requireActual('@nestjs/common');
    const { MicrobalancesEnvironmentUtils } = jest.requireActual('./infrastructure/environment/microbalances-environment.utils');
    const { EnvironmentUtils } = jest.requireActual('@commodo-sas/shared-libs/environment-config/environment-config.service');
    const { CommodoLoggerService, RequestContextService } = jest.requireActual('@commodo-sas/shared-libs/observability');
    const config = {
        enabled: false,
        queueUrl: 'http://localstack:4566/queue/us-east-1/000000000000/test-queue',
        concurrency: 2,
        region: 'us-east-1',
        waitTimeSeconds: 0,
    };
    class MicrobalancesEnvironmentModule {}
    common.Global()(MicrobalancesEnvironmentModule);
    common.Module({
        providers: [
            { provide: MicrobalancesEnvironmentUtils, useValue: { getMicrobalancesWorkerConfiguration: () => config } },
            { provide: EnvironmentUtils, useExisting: MicrobalancesEnvironmentUtils },
            { provide: CommodoLoggerService, useValue: { runtime: (...args: unknown[]) => mockRuntimeLog(...args) } },
            { provide: RequestContextService, useValue: {} },
        ],
        exports: [MicrobalancesEnvironmentUtils, EnvironmentUtils, CommodoLoggerService, RequestContextService],
    })(MicrobalancesEnvironmentModule);
    return { MicrobalancesEnvironmentModule };
});

describe('MicrobalancesModule composition', () => {
    it('resolves the use case, the store adapter, the SQS client and the consumer through the layer modules', async () => {
        const app = await NestFactory.createApplicationContext(MicrobalancesModule, { logger: false, abortOnError: false });

        expect(app.get(ApplyMicrobalancesService, { strict: false })).toBeInstanceOf(ApplyMicrobalancesService);
        expect(app.get(MicrobalanceStore, { strict: false })).toBeInstanceOf(MicrobalanceStoreRepository);
        expect(app.get(SQSClient, { strict: false })).toBeInstanceOf(SQSClient);
        expect(app.get(MicrobalancesSqsConsumer, { strict: false })).toBeInstanceOf(MicrobalancesSqsConsumer);
        expect(app.get(getDataSourceToken(EDatabaseConfig.DEFAULT), { strict: false })).toBe(mockDataSource);
        // Disabled by configuration: the consumer starts without polling.
        expect(mockRuntimeLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'microbalances.consumer.disabled' }));

        await app.close();
    });
});
