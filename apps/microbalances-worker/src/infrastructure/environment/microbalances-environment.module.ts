import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { MicrobalancesEnvironmentUtils } from './microbalances-environment.utils';

/** Single provider of the repository EnvironmentUtils; secrets are loaded before any getter is exposed. */
@Global()
@Module({
    imports: [ConfigModule.forRoot({ isGlobal: true })],
    providers: [
        {
            provide: MicrobalancesEnvironmentUtils,
            useFactory: async (configService: ConfigService) => {
                const environmentUtils = new MicrobalancesEnvironmentUtils(configService);
                await environmentUtils.getAllVariables();
                return environmentUtils;
            },
            inject: [ConfigService],
        },
        { provide: EnvironmentUtils, useExisting: MicrobalancesEnvironmentUtils },
    ],
    exports: [EnvironmentUtils, MicrobalancesEnvironmentUtils],
})
export class MicrobalancesEnvironmentModule {}
