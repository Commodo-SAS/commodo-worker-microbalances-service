import { Module } from '@nestjs/common';
import { MicrobalancesApplicationModule } from './application';
import { MicrobalancesInfrastructureModule, MicrobalancesPresenterInfrastructureModule } from './infrastructure';

/** Feature module: composes the application layer with its secondary and primary infrastructure. */
@Module({
    imports: [MicrobalancesApplicationModule, MicrobalancesInfrastructureModule, MicrobalancesPresenterInfrastructureModule],
    exports: [MicrobalancesApplicationModule, MicrobalancesInfrastructureModule, MicrobalancesPresenterInfrastructureModule],
})
export class MicrobalancesModule {}
