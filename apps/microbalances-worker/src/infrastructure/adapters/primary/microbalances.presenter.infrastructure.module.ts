import { Module } from '@nestjs/common';
import { MicrobalancesApplicationModule } from '../../../application';
import { MicrobalancesInfrastructureModule } from '../secondary';
import { MicrobalancesSqsConsumer } from './sqs';

/** Primary infrastructure: the SQS consumer that drives the use case; it starts and stops with the module. */
@Module({
    imports: [MicrobalancesApplicationModule, MicrobalancesInfrastructureModule],
    providers: [MicrobalancesSqsConsumer],
})
export class MicrobalancesPresenterInfrastructureModule {}
