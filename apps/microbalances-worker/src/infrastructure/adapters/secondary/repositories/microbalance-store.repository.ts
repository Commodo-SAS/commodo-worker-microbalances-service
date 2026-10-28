import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EDatabaseConfig } from '@commodo-sas/shared-libs/core/core/enums/database-config.enum';
import { MicrobalanceStore, MicrobalanceTransactionOptions, MicrobalanceUnit } from '../../../../domain/ports/secondary/microbalance-store.port';
import { MicrobalancesEnvironmentUtils, MicrobalancesWorkerConfiguration } from '../../../environment/microbalances-environment.utils';
import { MicrobalanceUnitRepository } from './microbalance-unit.repository';

const RETRYABLE_SQLSTATES = ['40001', '40P01', '55P03'];

/** True for PostgreSQL deadlocks, serialization failures and lock timeouts, which can succeed on a new attempt. */
function isRetryable(error: unknown): boolean {
    const code = (error as { driverError?: { code?: string }; code?: string })?.driverError?.code ?? (error as { code?: string })?.code;
    return typeof code === 'string' && RETRYABLE_SQLSTATES.includes(code);
}

/**
 * Runs microbalance work in a READ COMMITTED transaction with bounded statement, lock and idle-in-transaction
 * timeouts. Deadlocks, serialization failures and lock timeouts are retried up to the configured attempts while the
 * time budget allows. It wraps the shared connection instead of DBTransactionService because that service has no
 * per-transaction timeouts, does not retry lock timeouts (55P03), ignores a deadline and reports failures as a result
 * object instead of throwing.
 */
@Injectable()
export class MicrobalanceStoreRepository implements MicrobalanceStore {
    private readonly config: MicrobalancesWorkerConfiguration;

    /** Reads the worker configuration once; the connection comes from DBManagmentModule (default connection). */
    constructor(
        environmentUtils: MicrobalancesEnvironmentUtils,
        @InjectDataSource(EDatabaseConfig.DEFAULT) private readonly dataSource: DataSource,
    ) {
        this.config = environmentUtils.getMicrobalancesWorkerConfiguration();
    }

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
                    // Bound statements, lock waits and idle time for this transaction only (set_config with is_local = true).
                    // The idle limit frees the wallet locks if the process dies in the middle of a transaction.
                    await manager.query(
                        `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $3, true)`,
                        [String(this.config.dbStatementTimeoutMs), String(this.config.dbLockTimeoutMs), String(this.config.dbStatementTimeoutMs * 2)],
                    );
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
