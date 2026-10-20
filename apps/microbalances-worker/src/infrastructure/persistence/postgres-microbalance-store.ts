import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MicrobalanceStore, MicrobalanceTransactionOptions, MicrobalanceUnit } from '../../application/ports/microbalance-store.port';
import { MICROBALANCES_CONFIG } from '../config';
import { MicrobalancesWorkerConfiguration } from '../environment/microbalances-environment.utils';
import { TypeOrmMicrobalanceUnit } from './typeorm-microbalance-unit';

const RETRYABLE_SQLSTATES = ['40001', '40P01', '55P03'];

function isRetryable(error: unknown): boolean {
    const code = (error as { driverError?: { code?: string }; code?: string })?.driverError?.code ?? (error as { code?: string })?.code;
    return typeof code === 'string' && RETRYABLE_SQLSTATES.includes(code);
}

@Injectable()
export class PostgresMicrobalanceStore extends MicrobalanceStore {
    constructor(
        @Inject(MICROBALANCES_CONFIG) private readonly config: MicrobalancesWorkerConfiguration,
        private readonly dataSource: DataSource,
    ) {
        super();
    }

    async transaction<T>(work: (unit: MicrobalanceUnit) => Promise<T>, { deadlineAt }: MicrobalanceTransactionOptions): Promise<T> {
        for (let attempt = 1; ; attempt++) {
            try {
                return await this.dataSource.transaction('READ COMMITTED', async (manager) => {
                    await manager.query(`SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)`, [
                        String(this.config.dbStatementTimeoutMs),
                        String(this.config.dbLockTimeoutMs),
                    ]);
                    return work(new TypeOrmMicrobalanceUnit(manager));
                });
            } catch (error) {
                const delayMs = 50 * attempt + Math.floor(Math.random() * 100);
                if (!isRetryable(error) || attempt >= this.config.dbAttempts || Date.now() + delayMs + this.config.dbStatementTimeoutMs >= deadlineAt) {
                    throw error;
                }
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }
}
