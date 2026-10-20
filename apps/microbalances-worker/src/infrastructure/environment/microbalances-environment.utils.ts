import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';

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
    dependencyMaxReceives: number;
    shutdownDeadlineMs: number;
    dbAttempts: number;
    dbStatementTimeoutMs: number;
    dbLockTimeoutMs: number;
}

const LOCAL_EMULATOR_HOSTS = ['localhost', '127.0.0.1', 'localstack'];
const MICROBALANCES_WORKER_GROUP = 'MICROBALANCES_WORKER_CONFIG';

@Injectable()
export class MicrobalancesEnvironmentUtils extends EnvironmentUtils {
    private loadedSecrets: Record<string, any> = {};

    constructor(private readonly bootstrapConfig: ConfigService) {
        super(bootstrapConfig);
    }

    protected adaptSecrets(secrets: Record<string, any>): Record<string, any> {
        this.loadedSecrets = secrets ?? {};
        return super.adaptSecrets(secrets);
    }

    getBootstrapEnvironment(): string {
        return String(this.bootstrapConfig.get('ENV') ?? '').toUpperCase();
    }

    getMicrobalancesWorkerConfiguration(): MicrobalancesWorkerConfiguration {
        const environment = String(this.getEnv() || this.getBootstrapEnvironment() || '').toUpperCase();
        const enabled = this.readSetting('MICROBALANCES_WORKER_ENABLED') === 'true';
        const endpoint = this.readSetting('MICROBALANCES_AWS_ENDPOINT');
        const queueUrl = this.readSetting('MICROBALANCES_QUEUE_URL') ?? '';
        const accessKeyId = this.readSetting('MICROBALANCES_EMULATOR_ACCESS_KEY_ID');
        const secretAccessKey = this.readSetting('MICROBALANCES_EMULATOR_SECRET_ACCESS_KEY');

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
        if (endpoint && (!accessKeyId || !secretAccessKey)) throw new Error('LOCAL emulator credentials are required');
        if (!endpoint && (accessKeyId || secretAccessKey)) throw new Error('Emulator credentials are only allowed with a LOCAL emulator endpoint');

        const visibilityTimeoutSeconds = this.readInteger('MICROBALANCES_VISIBILITY_TIMEOUT_SECONDS', 60, 30, 900);
        const processingTimeoutMs = this.readInteger('MICROBALANCES_PROCESSING_TIMEOUT_MS', 45000, 1000, 900000);
        const dbStatementTimeoutMs = this.readInteger('MICROBALANCES_DB_STATEMENT_TIMEOUT_MS', 15000, 1000, 120000);
        const dbLockTimeoutMs = this.readInteger('MICROBALANCES_DB_LOCK_TIMEOUT_MS', 10000, 500, 120000);
        const retryBaseDelaySeconds = this.readInteger('MICROBALANCES_RETRY_BASE_DELAY_SECONDS', 5, 1, 3600);
        const retryMaxDelaySeconds = this.readInteger('MICROBALANCES_RETRY_MAX_DELAY_SECONDS', 300, 1, 43200);

        if (processingTimeoutMs >= visibilityTimeoutSeconds * 1000) throw new Error('Processing timeout must be lower than the visibility timeout');
        if (dbStatementTimeoutMs > processingTimeoutMs) throw new Error('Database statement timeout must not exceed the processing timeout');
        if (retryBaseDelaySeconds > retryMaxDelaySeconds) throw new Error('Retry base delay must not exceed the retry maximum delay');

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

    private readInteger(key: string, fallback: number, min: number, max: number): number {
        const raw = this.readSetting(key);
        if (raw === undefined) return fallback;
        const value = Number(raw);
        if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid microbalances configuration value for ${key}`);
        return value;
    }

    private readSetting(key: string): string | undefined {
        const group = this.parseGroup(this.loadedSecrets[MICROBALANCES_WORKER_GROUP]);
        const value: unknown = group[key] ?? this.loadedSecrets[key];
        if (value === undefined || value === null || value === '') return undefined;
        if (typeof value === 'string') return value.trim();
        if (typeof value === 'boolean' || typeof value === 'number') return String(value);
        throw new Error(`Invalid microbalances configuration value for ${key}`);
    }

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
