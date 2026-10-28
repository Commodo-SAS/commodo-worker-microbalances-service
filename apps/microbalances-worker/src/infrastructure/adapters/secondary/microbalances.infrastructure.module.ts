import { Module } from '@nestjs/common';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DBManagmentConnectionsModule } from '@commodo-sas/shared-libs/db-managment/db-managment-connections.module';
import { EDatabaseConfig } from '@commodo-sas/shared-libs/core/core/enums/database-config.enum';
import { MicrobalanceStore } from '../../../domain/ports';
import { MICROBALANCES_DEFAULT_ENTITIES } from '../../config/microbalances-entities';
import { MicrobalancesEnvironmentModule } from '../../environment/microbalances-environment.module';
import { MicrobalanceStoreRepository } from './repositories';
import { microbalancesSqsClientProvider } from './sqs';

/** Secondary infrastructure: the database connection, the SQS client and the adapter bound to the store port. */
@Module({
    imports: [
        MicrobalancesEnvironmentModule,
        // Shared database module without the default shared-libs entities (this worker maps its own rows); the pool size comes from the connection secret (orm.pool).
        DBManagmentConnectionsModule.forRoot({
            connections: [{ name: EDatabaseConfig.DEFAULT, entities: MICROBALANCES_DEFAULT_ENTITIES }],
        }),
    ],
    providers: [
        microbalancesSqsClientProvider,
        // The abstract port is its own injection token.
        { provide: MicrobalanceStore, useClass: MicrobalanceStoreRepository },
    ],
    exports: [MicrobalanceStore, SQSClient],
})
export class MicrobalancesInfrastructureModule {}
