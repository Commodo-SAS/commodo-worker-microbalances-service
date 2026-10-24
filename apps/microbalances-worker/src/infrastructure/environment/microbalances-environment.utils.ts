import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';

/**
 * Validated settings of the microbalances worker, read from the MICROBALANCES_WORKER_CONFIG group of the secrets.
 * Timeouts are kept consistent: processing below visibility, database statement below processing.
 */
export interface MicrobalancesWorkerConfiguration {
    enabled: boolean;
    environment: string;
    region: string;
    endpoint?: string;
    emulatorCredentials?: { accessKeyId: string; secretAccessKey: string };
    queueUrl: string;
    concurrency: number;
    batchSize: number;
    waitTimeSeconds: number;
    visibilityTimeoutSeconds: number;
    processingTimeoutMs: number;
    pollErrorBackoffMs: number;
    retryBaseDelaySeconds: number;
    retryMaxDelaySeconds: number;
    /** Receives after which a movement still waiting for its antecedent is logged and acknowledged instead of retried. */
    dependencyMaxReceives: number;
    shutdownDeadlineMs: number;
    dbAttempts: number;
    dbStatementTimeoutMs: number;
    dbLockTimeoutMs: number;
}

const LOCAL_EMULATOR_HOSTS = ['localhost', '127.0.0.1', 'localstack'];
const MICROBALANCES_WORKER_GROUP = 'MICROBALANCES_WORKER_CONFIG';

/** Repository EnvironmentUtils: adds the microbalances getters on top of the shared one. */
@Injectable()
export class MicrobalancesEnvironmentUtils extends EnvironmentUtils {
    private loadedSecrets: Record<string, any> = {};

    constructor(private readonly bootstrapConfig: ConfigService) {
        super(bootstrapConfig);
    }

    /** Keeps the loaded secrets so the grouped microbalances settings can be read later through the repository getters. */
    protected adaptSecrets(secrets: Record<string, any>): Record<string, any> {
        this.loadedSecrets = secrets ?? {};
        return super.adaptSecrets(secrets);
    }

    /** API prefix of the shared liveness endpoint; defaults to the service name when the secrets do not define one. */
    getApiPrefix(): string {
        return super.getApiPrefix() ?? 'microbalances/api';
    }

    /** Port of the liveness listener; falls back to 8000 when the bootstrap configuration has no port. */
    getMicrobalancesServerPort(): number {
        return super.getServerPort('commodo-worker-microbalances') || 8000;
    }

    /** Environment from the bootstrap file (ENV); used to confirm that emulator overrides only happen in LOCAL. */
    getBootstrapEnvironment(): string {
        return String(this.bootstrapConfig.get('ENV') ?? '').toUpperCase();
    }

    /**
     * @throws Error when a value is out of range, timeouts are inconsistent or an emulator override is used outside LOCAL.
     */
    getMicrobalancesWorkerConfiguration(): MicrobalancesWorkerConfiguration {
        // Resolve the environment and the raw settings first; validation follows.
        const environment = String(this.getEnv() || this.getBootstrapEnvironment() || '').toUpperCase();
        const enabled = this.readSetting('MICROBALANCES_WORKER_ENABLED') === 'true';
        const endpoint = this.readSetting('MICROBALANCES_AWS_ENDPOINT');
        const queueUrl = this.readSetting('MICROBALANCES_QUEUE_URL') ?? '';
        const accessKeyId = this.readSetting('MICROBALANCES_EMULATOR_ACCESS_KEY_ID');
        const secretAccessKey = this.readSetting('MICROBALANCES_EMULATOR_SECRET_ACCESS_KEY');

        // An emulator endpoint is a LOCAL-only override.
        if (endpoint) {
            let url: URL;
            try {
                url = new URL(endpoint);
            } catch {
                throw new Error('Invalid emulator endpoint');
            }
            if (environment !== 'LOCAL' || this.getBootstrapEnvironment() !== 'LOCAL' || !LOCAL_EMULATOR_HOSTS.includes(url.hostname)) {
                throw new Error('Only LOCAL emulator overrides are allowed');
            }
            if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid emulator endpoint');
        }
        // A queue URL is only required when the consumer is enabled.
        if (enabled) {
            let queue: URL;
            try {
                queue = new URL(queueUrl);
            } catch {
                throw new Error('Missing microbalances transport configuration');
            }
            if (!['http:', 'https:'].includes(queue.protocol) || !queue.pathname.split('/').pop()) {
                throw new Error('Missing microbalances transport configuration');
            }
            if (environment === 'LOCAL' && (!endpoint || queue.origin !== new URL(endpoint).origin)) {
                throw new Error('LOCAL microbalances must use emulator queue URL');
            }
        }
        // Emulator credentials travel with the endpoint and are forbidden anywhere else.
        if (endpoint && (!accessKeyId || !secretAccessKey)) throw new Error('LOCAL emulator credentials are required');
        if (!endpoint && (accessKeyId || secretAccessKey)) throw new Error('Emulator credentials are only allowed with a LOCAL emulator endpoint');

        // Timeouts must nest (database statement < processing < visibility) so a message is never redelivered while it is still being processed.
        const visibilityTimeoutSeconds = this.readInteger('MICROBALANCES_VISIBILITY_TIMEOUT_SECONDS', 60, 30, 900);
        const processingTimeoutMs = this.readInteger('MICROBALANCES_PROCESSING_TIMEOUT_MS', 45000, 1000, 900000);
        const dbStatementTimeoutMs = this.readInteger('MICROBALANCES_DB_STATEMENT_TIMEOUT_MS', 15000, 1000, 120000);
        const dbLockTimeoutMs = this.readInteger('MICROBALANCES_DB_LOCK_TIMEOUT_MS', 10000, 500, 120000);
        const retryBaseDelaySeconds = this.readInteger('MICROBALANCES_RETRY_BASE_DELAY_SECONDS', 5, 1, 3600);
        const retryMaxDelaySeconds = this.readInteger('MICROBALANCES_RETRY_MAX_DELAY_SECONDS', 300, 1, 43200);

        if (processingTimeoutMs >= visibilityTimeoutSeconds * 1000) throw new Error('Processing timeout must be lower than the visibility timeout');
        if (dbStatementTimeoutMs > processingTimeoutMs) throw new Error('Database statement timeout must not exceed the processing timeout');
        if (retryBaseDelaySeconds > retryMaxDelaySeconds) throw new Error('Retry base delay must not exceed the retry maximum delay');

        // Every numeric setting is range-checked by readInteger and falls back to the documented default.
        return {
            enabled,
            environment,
            region: this.getAwsRegion() || 'us-east-1',
            endpoint,
            emulatorCredentials: endpoint ? { accessKeyId, secretAccessKey } : undefined,
            queueUrl,
            concurrency: this.readInteger('MICROBALANCES_CONCURRENCY', 4, 1, 16),
            batchSize: this.readInteger('MICROBALANCES_BATCH_SIZE', 1, 1, 10),
            waitTimeSeconds: this.readInteger('MICROBALANCES_WAIT_TIME_SECONDS', 20, 0, 20),
            visibilityTimeoutSeconds,
            processingTimeoutMs,
            pollErrorBackoffMs: this.readInteger('MICROBALANCES_POLL_ERROR_BACKOFF_MS', 5000, 100, 60000),
            retryBaseDelaySeconds,
            retryMaxDelaySeconds,
            dependencyMaxReceives: this.readInteger('MICROBALANCES_DEPENDENCY_MAX_RECEIVES', 8, 1, 50),
            shutdownDeadlineMs: this.readInteger('MICROBALANCES_SHUTDOWN_DEADLINE_MS', 30000, 1000, 120000),
            dbAttempts: this.readInteger('MICROBALANCES_DB_ATTEMPTS', 3, 1, 5),
            dbStatementTimeoutMs,
            dbLockTimeoutMs,
        };
    }

    /**
     * Reads an integer setting within its allowed range.
     * @throws Error when the value is not an integer inside the range.
     */
    private readInteger(key: string, fallback: number, min: number, max: number): number {
        const raw = this.readSetting(key);
        if (raw === undefined) return fallback;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid microbalances configuration value for ${key}`);
        return value;
    }

    /**
     * Reads a setting from the MICROBALANCES_WORKER_CONFIG group, falling back to a top-level key.
     * @returns The trimmed value, or undefined when it is absent.
     * @throws Error when the value is not a string, number or boolean.
     */
    private readSetting(key: string): string | undefined {
        const group = this.parseGroup(this.loadedSecrets[MICROBALANCES_WORKER_GROUP]);
        const value: unknown = group[key] ?? this.loadedSecrets[key];
        if (value === undefined || value === null || value === '') return undefined;
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'boolean' || typeof value === 'number') return String(value);
        throw new Error(`Invalid microbalances configuration value for ${key}`);
    }

    /** The group may arrive as an object or as a JSON string depending on the secret source; anything else is an empty group. */
    private parseGroup(raw: unknown): Record<string, unknown> {
        if (typeof raw === 'string') {
            try {
                const parsed: unknown = JSON.parse(raw);
                return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
            } catch {
                return {};
            }
        }
        return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    }
}
