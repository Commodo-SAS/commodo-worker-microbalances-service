import { ConfigService } from '@nestjs/config';
import { MicrobalancesEnvironmentUtils } from './microbalances-environment.utils';

const QUEUE = 'http://localstack:4566/queue/us-east-1/000000000000/commodo-local-loyalty-microbalances';

function utils(secrets: Record<string, unknown>, bootstrapEnv = 'LOCAL'): MicrobalancesEnvironmentUtils {
    const instance = new MicrobalancesEnvironmentUtils({
        get: (key: string) => (key === 'ENV' ? bootstrapEnv : undefined),
    } as unknown as ConfigService);
    (instance as unknown as { secretVariables: unknown }).secretVariables = secrets;
    (instance as unknown as { loadedSecrets: unknown }).loadedSecrets = secrets;
    return instance;
}

function localSecrets(group: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        ENVIRONMENT_CONFIG: { ENV: 'LOCAL' },
        AWS_CONFIG: { AWS_REGION: 'us-east-1' },
        MICROBALANCES_WORKER_CONFIG: {
            MICROBALANCES_WORKER_ENABLED: true,
            MICROBALANCES_AWS_ENDPOINT: 'http://localstack:4566',
            MICROBALANCES_EMULATOR_ACCESS_KEY_ID: 'test',
            MICROBALANCES_EMULATOR_SECRET_ACCESS_KEY: 'test',
            MICROBALANCES_QUEUE_URL: QUEUE,
            ...group,
        },
    };
}

describe('MicrobalancesEnvironmentUtils.getMicrobalancesWorkerConfiguration', () => {
    it('resolves the environment from ENVIRONMENT_CONFIG.ENV and the region from AWS_CONFIG', () => {
        const config = utils(localSecrets()).getMicrobalancesWorkerConfiguration();

        expect(config).toMatchObject({ enabled: true, environment: 'LOCAL', region: 'us-east-1', queueUrl: QUEUE });
        expect(config.emulatorCredentials).toEqual({ accessKeyId: 'test', secretAccessKey: 'test' });
    });

    it('applies the documented defaults', () => {
        expect(utils(localSecrets()).getMicrobalancesWorkerConfiguration()).toMatchObject({
            concurrency: 4,
            batchSize: 1,
            waitTimeSeconds: 20,
            visibilityTimeoutSeconds: 60,
            processingTimeoutMs: 45000,
            pollErrorBackoffMs: 5000,
            retryBaseDelaySeconds: 5,
            retryMaxDelaySeconds: 300,
            dependencyMaxReceives: 8,
            shutdownDeadlineMs: 30000,
            dbAttempts: 3,
            dbStatementTimeoutMs: 15000,
            dbLockTimeoutMs: 10000,
        });
    });

    it('is disabled unless explicitly enabled and does not require a queue then', () => {
        const config = utils({
            ENVIRONMENT_CONFIG: { ENV: 'LOCAL' },
            MICROBALANCES_WORKER_CONFIG: { MICROBALANCES_WORKER_ENABLED: false },
        }).getMicrobalancesWorkerConfiguration();

        expect(config.enabled).toBe(false);
        expect(config.queueUrl).toBe('');
    });

    it('reads grouped settings from a JSON string and overrides from top-level keys', () => {
        const secrets = localSecrets();
        secrets.MICROBALANCES_WORKER_CONFIG = JSON.stringify(secrets.MICROBALANCES_WORKER_CONFIG);
        secrets.MICROBALANCES_CONCURRENCY = '8';

        expect(utils(secrets).getMicrobalancesWorkerConfiguration().concurrency).toBe(8);
    });

    it('lets the grouped value win over the top-level one', () => {
        const secrets = { ...localSecrets({ MICROBALANCES_CONCURRENCY: 2 }), MICROBALANCES_CONCURRENCY: 9 };

        expect(utils(secrets).getMicrobalancesWorkerConfiguration().concurrency).toBe(2);
    });

    it('requires a valid queue URL when enabled', () => {
        expect(() => utils(localSecrets({ MICROBALANCES_QUEUE_URL: '' })).getMicrobalancesWorkerConfiguration()).toThrow(
            'Missing microbalances transport',
        );
        expect(() => utils(localSecrets({ MICROBALANCES_QUEUE_URL: 'not a url' })).getMicrobalancesWorkerConfiguration()).toThrow(
            'Missing microbalances transport',
        );
        expect(() => utils(localSecrets({ MICROBALANCES_QUEUE_URL: 'http://localstack:4566/' })).getMicrobalancesWorkerConfiguration()).toThrow(
            'Missing microbalances transport',
        );
    });

    it('requires the LOCAL queue to belong to the emulator endpoint', () => {
        expect(() =>
            utils(
                localSecrets({ MICROBALANCES_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/queue' }),
            ).getMicrobalancesWorkerConfiguration(),
        ).toThrow('LOCAL microbalances must use emulator queue URL');
    });

    it('rejects emulator endpoints outside LOCAL', () => {
        const secrets = localSecrets();
        (secrets.ENVIRONMENT_CONFIG as Record<string, string>).ENV = 'DEV';

        expect(() => utils(secrets).getMicrobalancesWorkerConfiguration()).toThrow('Only LOCAL emulator overrides are allowed');
        expect(() => utils(localSecrets(), 'DEV').getMicrobalancesWorkerConfiguration()).toThrow('Only LOCAL emulator overrides are allowed');
    });

    it('rejects emulator endpoints that are not local hosts or carry credentials', () => {
        expect(() => utils(localSecrets({ MICROBALANCES_AWS_ENDPOINT: 'http://example.com:4566' })).getMicrobalancesWorkerConfiguration()).toThrow(
            'Only LOCAL emulator overrides are allowed',
        );
        expect(() =>
            utils(localSecrets({ MICROBALANCES_AWS_ENDPOINT: 'http://user:pass@localstack:4566' })).getMicrobalancesWorkerConfiguration(),
        ).toThrow('Invalid emulator endpoint');
        expect(() => utils(localSecrets({ MICROBALANCES_AWS_ENDPOINT: 'nope' })).getMicrobalancesWorkerConfiguration()).toThrow(
            'Invalid emulator endpoint',
        );
    });

    it('requires emulator credentials with an endpoint and forbids them without one', () => {
        expect(() => utils(localSecrets({ MICROBALANCES_EMULATOR_ACCESS_KEY_ID: '' })).getMicrobalancesWorkerConfiguration()).toThrow(
            'LOCAL emulator credentials are required',
        );

        const cloud = {
            ENVIRONMENT_CONFIG: { ENV: 'PROD' },
            MICROBALANCES_WORKER_CONFIG: {
                MICROBALANCES_WORKER_ENABLED: true,
                MICROBALANCES_QUEUE_URL: QUEUE,
                MICROBALANCES_EMULATOR_ACCESS_KEY_ID: 'k',
                MICROBALANCES_EMULATOR_SECRET_ACCESS_KEY: 's',
            },
        };
        expect(() => utils(cloud, 'PROD').getMicrobalancesWorkerConfiguration()).toThrow('Emulator credentials are only allowed');
    });

    it('configures a cloud environment without endpoint or emulator credentials', () => {
        const cloud = {
            ENVIRONMENT_CONFIG: { ENV: 'PROD' },
            AWS_CONFIG: { AWS_REGION: 'us-east-2' },
            MICROBALANCES_WORKER_CONFIG: {
                MICROBALANCES_WORKER_ENABLED: true,
                MICROBALANCES_QUEUE_URL: 'https://sqs.us-east-2.amazonaws.com/123456789012/loyalty-microbalances',
            },
        };

        expect(utils(cloud, 'PROD').getMicrobalancesWorkerConfiguration()).toMatchObject({
            environment: 'PROD',
            region: 'us-east-2',
            endpoint: undefined,
            emulatorCredentials: undefined,
        });
    });

    it.each([
        ['MICROBALANCES_CONCURRENCY', 0],
        ['MICROBALANCES_CONCURRENCY', 17],
        ['MICROBALANCES_BATCH_SIZE', 11],
        ['MICROBALANCES_WAIT_TIME_SECONDS', 21],
        ['MICROBALANCES_DB_ATTEMPTS', 6],
        ['MICROBALANCES_DEPENDENCY_MAX_RECEIVES', 0],
        ['MICROBALANCES_CONCURRENCY', 'many'],
        ['MICROBALANCES_CONCURRENCY', 2.5],
    ])('rejects %s=%s', (key, value) => {
        expect(() => utils(localSecrets({ [key]: value })).getMicrobalancesWorkerConfiguration()).toThrow(
            `Invalid microbalances configuration value for ${key}`,
        );
    });

    it('requires the processing timeout to stay below the visibility timeout', () => {
        expect(() =>
            utils(
                localSecrets({ MICROBALANCES_VISIBILITY_TIMEOUT_SECONDS: 30, MICROBALANCES_PROCESSING_TIMEOUT_MS: 30000 }),
            ).getMicrobalancesWorkerConfiguration(),
        ).toThrow('Processing timeout must be lower than the visibility timeout');
    });

    it('requires the database statement timeout to fit in the processing timeout', () => {
        expect(() =>
            utils(
                localSecrets({ MICROBALANCES_PROCESSING_TIMEOUT_MS: 10000, MICROBALANCES_DB_STATEMENT_TIMEOUT_MS: 15000 }),
            ).getMicrobalancesWorkerConfiguration(),
        ).toThrow('Database statement timeout must not exceed the processing timeout');
    });

    it('requires the retry base delay not to exceed the maximum', () => {
        expect(() =>
            utils(
                localSecrets({ MICROBALANCES_RETRY_BASE_DELAY_SECONDS: 400, MICROBALANCES_RETRY_MAX_DELAY_SECONDS: 300 }),
            ).getMicrobalancesWorkerConfiguration(),
        ).toThrow('Retry base delay must not exceed the retry maximum delay');
    });

    it('rejects non-scalar setting values', () => {
        expect(() => utils(localSecrets({ MICROBALANCES_CONCURRENCY: { nested: 1 } })).getMicrobalancesWorkerConfiguration()).toThrow(
            'Invalid microbalances configuration value for MICROBALANCES_CONCURRENCY',
        );
    });
});

describe('MicrobalancesEnvironmentUtils liveness settings', () => {
    it('defaults the API prefix to the service name and honors API_CONFIG', () => {
        expect(utils(localSecrets()).getApiPrefix()).toBe('microbalances/api');
        expect(utils({ ...localSecrets(), API_CONFIG: { API_PREFIX: 'custom/api' } }).getApiPrefix()).toBe('custom/api');
    });

    it('defaults the liveness port to 8000 and honors the bootstrap configuration of the service', () => {
        expect(utils(localSecrets()).getMicrobalancesServerPort()).toBe(8000);

        const configured = { ...localSecrets(), BOOTSTRAP_CONFIGURATION: { apps: { 'commodo-worker-microbalances': { port: 8123 } } } };
        expect(utils(configured).getMicrobalancesServerPort()).toBe(8123);
    });
});
