import { SQSClient } from '@aws-sdk/client-sqs';
import { MicrobalancesEnvironmentUtils } from '../../../environment/microbalances-environment.utils';

/**
 * SQS client with bounded connection and request timeouts; the emulator endpoint is only set for LOCAL.
 * The SDK class is its own injection token, so no extra token is needed.
 */
export const microbalancesSqsClientProvider = {
    provide: SQSClient,
    inject: [MicrobalancesEnvironmentUtils],
    useFactory: (environmentUtils: MicrobalancesEnvironmentUtils): SQSClient => {
        const config = environmentUtils.getMicrobalancesWorkerConfiguration();
        return new SQSClient({
            region: config.region,
            maxAttempts: 3,
            requestHandler: { connectionTimeout: 5000, requestTimeout: (config.waitTimeSeconds + 10) * 1000 },
            ...(config.endpoint ? { endpoint: config.endpoint, credentials: config.emulatorCredentials } : {}),
        });
    },
};
