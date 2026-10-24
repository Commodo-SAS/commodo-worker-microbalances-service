import { SQSClient } from '@aws-sdk/client-sqs';
import { MICROBALANCES_CONFIG } from '../../../config/microbalances-worker.config';
import { MicrobalancesWorkerConfiguration } from '../../../environment/microbalances-environment.utils';

export const MICROBALANCES_SQS_CLIENT = Symbol('MICROBALANCES_SQS_CLIENT');

/** SQS client with bounded connection and request timeouts; the emulator endpoint is only set for LOCAL. */
export const microbalancesSqsClientProvider = {
    provide: MICROBALANCES_SQS_CLIENT,
    inject: [MICROBALANCES_CONFIG],
    useFactory: (config: MicrobalancesWorkerConfiguration): SQSClient =>
        new SQSClient({
            region: config.region,
            maxAttempts: 3,
            requestHandler: { connectionTimeout: 5000, requestTimeout: (config.waitTimeSeconds + 10) * 1000 },
            ...(config.endpoint ? { endpoint: config.endpoint, credentials: config.emulatorCredentials } : {}),
        }),
};
