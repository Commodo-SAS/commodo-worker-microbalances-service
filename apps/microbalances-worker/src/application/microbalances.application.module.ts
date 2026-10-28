import { Module } from '@nestjs/common';
import { MicrobalancesInfrastructureModule } from '../infrastructure/adapters/secondary';
import { ApplyMicrobalancesService } from './use-cases';

/** Application layer: the use case, which receives the store port from the secondary infrastructure module. */
@Module({
    imports: [MicrobalancesInfrastructureModule],
    providers: [ApplyMicrobalancesService],
    exports: [ApplyMicrobalancesService],
})
export class MicrobalancesApplicationModule {}
