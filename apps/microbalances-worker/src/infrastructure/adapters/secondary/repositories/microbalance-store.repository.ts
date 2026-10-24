import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MicrobalanceStore, MicrobalanceTransactionOptions, MicrobalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { MICROBALANCES_CONFIG } from '../../../config/microbalances-worker.config';
import { MicrobalancesWorkerConfiguration } from '../../../environment/microbalances-environment.utils';
import { MicrobalanceUnitRepository } from './microbalance-unit.repository';

const RETRYABLE_SQLSTATES = ['40001', '40P01', '55P03'];

/** True for PostgreSQL deadlocks, serialization failures and lock timeouts, which can succeed on a new attempt. */
function isRetryable(error: unknown): boolean {
    const code = (error as { driverError?: { code?: string }; code?: string })?.driverError?.code ?? (error as { code?: string })?.code;
    return typeof code === 'string' && RETRYABLE_SQLSTATES.includes(code);
}

/**
 * Runs microbalance work in a READ COMMITTED transaction with bounded statement and lock timeouts. Deadlocks,
 * serialization failures and lock timeouts are retried up to the configured attempts while the time budget allows.
 */
@Injectable()
export class MicrobalanceStoreRepository implements MicrobalanceStore {
    constructor(
        @Inject(MICROBALANCES_CONFIG) private readonly config: MicrobalancesWorkerConfiguration,
        private readonly dataSource: DataSource,
    ) {}

    /**
     * Runs the work in one transaction and retries it while the failure is transient and time remains.
     * @param work - Callback that receives the transaction-bound unit; throwing rolls everything back.
     * @param options - Time budget shared by every attempt.
     */
    async transaction<T>(work: (unit: MicrobalanceUnit) => Promise<T>, { deadlineAt }: MicrobalanceTransactionOptions): Promise<T> {
        // Each attempt is a fresh transaction; the loop only continues for transient failures.
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.dataSource.transaction('READ COMMITTED', async (manager) => {
                    // Bound statements and lock waits for this transaction only (set_config with is_local = true).
                    await manager.query(`SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)`, [
                        String(this.config.dbStatementTimeoutMs),
                        String(this.config.dbLockTimeoutMs),
                    ]);
                    // The unit shares this transaction, including the idempotency claim.
                    return work(new MicrobalanceUnitRepository(manager));
                });
            } catch (error) {
                // Retry only transient failures, within the attempt limit and the remaining time budget.
                const delayMs = 50 * attempt + Math.floor(Math.random() * 100);
                if (
                    !isRetryable(error) ||
                    attempt >= this.config.dbAttempts ||
                    Date.now() + delayMs + this.config.dbStatementTimeoutMs >= deadlineAt
                ) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
}
