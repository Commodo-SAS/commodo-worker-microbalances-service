import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EDatabaseConfig } from '@commodo-sas/shared-libs/core/core/enums/database-config.enum';
import { EnvironmentUtils } from '@commodo-sas/shared-libs/environment-config/environment-config.service';
import { ObservabilityModule } from '@commodo-sas/shared-libs/observability';
import { ApplyMicrobalancesService, MicrobalancesApplicationModule } from '../../src/application';
import { MicrobalanceEnvelope } from '../../src/domain/models/microbalance-event';
import { MicrobalancesEnvironmentModule } from '../../src/infrastructure/environment/microbalances-environment.module';

/**
 * Measures the two risks left unfixed on purpose: FOR UPDATE contention on hot wallets and serial writes per bag.
 * It talks to the local test database through the real modules and tags every row it creates with ITEST so it can
 * delete exactly what it created. Run with the integration jest config, never with `pnpm test`.
 */
@Module({
    imports: [
        MicrobalancesEnvironmentModule,
        ObservabilityModule.forRootAsync({
            imports: [MicrobalancesEnvironmentModule],
            inject: [EnvironmentUtils],
            useFactory: (environmentUtils: EnvironmentUtils) => ({
                serviceName: 'microbalances-integration',
                environment: environmentUtils.getEnv(),
                version: '0.0.0',
                logLevel: 'error',
                requestAudit: { enabled: false },
                tracing: { enabled: false },
            }),
        }),
        MicrobalancesApplicationModule,
    ],
})
class IntegrationModule {}

const RUN = Date.now().toString(36);
let nextId = 800_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 100;
let eventCounter = 0;

interface Sample {
    ms: number;
    outcome: string;
}

/** Percentile of a sorted array. */
function pct(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

describe('microbalances contention against the local test database', () => {
    let app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>;
    let ds: DataSource;
    let apply: ApplyMicrobalancesService;
    let attempts = 0;
    const report: string[] = [];

    const q = (sql: string, params: unknown[] = []): Promise<Array<Record<string, number | string>>> => ds.query(sql, params);

    /** Deletes only what this harness creates (ITEST tags), children first. */
    async function cleanup(): Promise<void> {
        await q(
            `DELETE FROM transaction_balance_reference WHERE transaction_id IN (SELECT id FROM transactions WHERE pos_transaction_id LIKE 'ITEST-%')
             OR wallet_balance_id IN (SELECT id FROM wallet_balances WHERE wallet_id IN (SELECT id FROM wallets WHERE name = 'ITEST'))`,
        );
        await q(
            `DELETE FROM wallet_balances WHERE wallet_id IN (SELECT id FROM wallets WHERE name = 'ITEST')
             OR transaction_id IN (SELECT id FROM transactions WHERE pos_transaction_id LIKE 'ITEST-%')`,
        );
        await q(`DELETE FROM transactions WHERE pos_transaction_id LIKE 'ITEST-%'`);
        await q(`DELETE FROM wallets WHERE name = 'ITEST'`);
        await q(`DELETE FROM persons WHERE names = 'ITEST'`);
        await q(`DELETE FROM users WHERE username LIKE 'ITEST-%'`);
        await q(`DELETE FROM processed_events WHERE event_id LIKE 'itest-%'`);
    }

    /** Creates wallets (with their person) tagged ITEST and returns their ids. */
    async function seedWallets(count: number): Promise<number[]> {
        const ids = Array.from({ length: count }, () => nextId++);
        await q(`INSERT INTO users (id, username, password, check_tc) SELECT x, 'ITEST-' || x, 'x', false FROM unnest($1::bigint[]) x`, [ids]);
        await q(`INSERT INTO persons (id, names, surnames, phone_number) SELECT x, 'ITEST', 'ITEST', 'IT' || x FROM unnest($1::bigint[]) x`, [ids]);
        await q(`INSERT INTO wallets (id, person_id, account_number, name) SELECT x, x, 'ITEST-' || x, 'ITEST' FROM unnest($1::bigint[]) x`, [ids]);
        return ids;
    }

    /** Creates tagged transaction rows, which the bags reference by foreign key. */
    async function seedTransactions(count: number, typeId: number): Promise<number[]> {
        const ids = Array.from({ length: count }, () => nextId++);
        await q(
            `INSERT INTO transactions (id, transaction_type_id, previus_balance_maker, amount, pos_transaction_id, pos_operation_id, transaction_status_code)
             SELECT x, $2, 0, 1, 'ITEST-' || x, '1', 'TRANSCONFIRMED' FROM unnest($1::bigint[]) x`,
            [ids, typeId],
        );
        return ids;
    }

    /** Gives a wallet `count` available bags of 1.00 created by one seed transaction. */
    async function seedBags(walletId: number, count: number): Promise<void> {
        const [seedTx] = await seedTransactions(1, 11);
        await q(
            `INSERT INTO wallet_balances (wallet_id, transaction_id, original_amount, available_amount, created_at)
             SELECT $1, $2, 1, 1, now() - (g || ' seconds')::interval FROM generate_series(1, $3) g`,
            [walletId, seedTx, count],
        );
    }

    function envelope(transactionId: number, payload: Record<string, unknown>): MicrobalanceEnvelope {
        return {
            eventId: `itest-${RUN}-${eventCounter++}`,
            eventType: 'transaction.microbalances.requested',
            version: 1,
            occurredAt: new Date().toISOString(),
            service: 'integration',
            environment: 'LOCAL',
            correlationId: `corr-${eventCounter}`,
            transactionId: String(transactionId),
            payload: { transactionId, status: 'TRANSCONFIRMED', allowSenderDebt: false, userId: 1, ...payload },
        };
    }

    /** Runs every job with `concurrency` loops; each loop takes the next job until none are left. */
    async function runLoad(name: string, concurrency: number, jobs: Array<(slot: number) => MicrobalanceEnvelope>): Promise<void> {
        const samples: Sample[] = [];
        const attemptsBefore = attempts;
        let cursor = 0;
        const started = Date.now();
        await Promise.all(
            Array.from({ length: concurrency }, async (_, slot) => {
                while (cursor < jobs.length) {
                    const job = jobs[cursor++];
                    const t0 = process.hrtime.bigint();
                    let outcome = 'applied';
                    try {
                        const result = await apply.execute({ envelope: job(slot), expectedEnvironment: 'LOCAL', deadlineAt: Date.now() + 30000 });
                        outcome = result.status;
                    } catch (error) {
                        const code = (error as { driverError?: { code?: string } }).driverError?.code;
                        outcome = `${(error as Error).name}${code ? `:${code}` : ''}`;
                    }
                    samples.push({ ms: Number(process.hrtime.bigint() - t0) / 1e6, outcome });
                }
            }),
        );
        const wall = (Date.now() - started) / 1000;
        const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
        const outcomes: Record<string, number> = {};
        for (const s of samples) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
        const retries = attempts - attemptsBefore - jobs.length;
        report.push(
            `${name} conc=${concurrency} n=${jobs.length} wall=${wall.toFixed(2)}s thr=${(jobs.length / wall).toFixed(1)}/s ` +
                `p50=${pct(sorted, 50).toFixed(1)}ms p95=${pct(sorted, 95).toFixed(1)}ms p99=${pct(sorted, 99).toFixed(1)}ms ` +
                `max=${(sorted[sorted.length - 1] ?? 0).toFixed(1)}ms tx_retries=${retries} outcomes=${JSON.stringify(outcomes)}`,
        );
    }

    beforeAll(async () => {
        app = await NestFactory.createApplicationContext(IntegrationModule, { logger: ['error'] });
        ds = app.get(getDataSourceToken(EDatabaseConfig.DEFAULT), { strict: false });
        apply = app.get(ApplyMicrobalancesService, { strict: false });
        const original = ds.transaction.bind(ds) as (...args: unknown[]) => Promise<unknown>;
        (ds as unknown as { transaction: unknown }).transaction = (...args: unknown[]) => {
            attempts++;
            return original(...args);
        };
        await cleanup();
        const [{ db }] = await q('select current_database() as db');
        report.push(`database=${db} pool.max=${(ds.options as { extra?: { max?: number } }).extra?.max}`);
    });

    afterAll(async () => {
        try {
            await cleanup();
            const [left] = await q(
                `SELECT (SELECT count(*) FROM wallets WHERE name='ITEST') w, (SELECT count(*) FROM users WHERE username LIKE 'ITEST-%') u, (SELECT count(*) FROM transactions WHERE pos_transaction_id LIKE 'ITEST-%') t,
                        (SELECT count(*) FROM processed_events WHERE event_id LIKE 'itest-%') p`,
            );
            report.push(`cleanup leftovers=${JSON.stringify(left)}`);
        } finally {
            process.stdout.write(`\n===== MEASUREMENTS =====\n${report.join('\n')}\n========================\n`);
            await app.close();
        }
    });

    const levels = [1, 4, 8];

    it('A/B: cashback to disjoint wallets (baseline) versus one hot receiver wallet', async () => {
        for (const conc of levels) {
            const wallets = await seedWallets(conc);
            const txs = await seedTransactions(160, 2);
            await runLoad(
                'disjoint-receivers',
                conc,
                txs.map((tx) => (slot) => envelope(tx, { transactionTypeId: 2, amount: '1.00', walletReceiverId: wallets[slot] })),
            );
        }
        for (const conc of levels) {
            const [hot] = await seedWallets(1);
            const txs = await seedTransactions(160, 2);
            await runLoad(
                'hot-receiver',
                conc,
                txs.map((tx) => () => envelope(tx, { transactionTypeId: 2, amount: '1.00', walletReceiverId: hot })),
            );
        }
    });

    it('C: serial writes per bag, one transfer consuming M bags', async () => {
        for (const bags of [1, 10, 50, 100]) {
            const reps = 5;
            const [sender, receiver] = await seedWallets(2);
            await seedBags(sender, bags * reps);
            const txs = await seedTransactions(reps, 3);
            await runLoad(
                `transfer-bags=${bags}`,
                1,
                txs.map(
                    (tx) => () => envelope(tx, { transactionTypeId: 3, amount: String(bags), walletTransferId: sender, walletReceiverId: receiver }),
                ),
            );
        }
    });

    it('D: concurrent transfers from one hot sender, and consistency of the totals', async () => {
        for (const conc of levels) {
            const events = 40;
            const perEvent = 5;
            const [sender, receiver] = await seedWallets(2);
            await seedBags(sender, events * perEvent);
            const txs = await seedTransactions(events, 3);
            await runLoad(
                'hot-sender-transfer',
                conc,
                txs.map(
                    (tx) => () =>
                        envelope(tx, { transactionTypeId: 3, amount: String(perEvent), walletTransferId: sender, walletReceiverId: receiver }),
                ),
            );
            const [s] = await q(`SELECT coalesce(sum(available_amount),0)::float a FROM wallet_balances WHERE wallet_id=$1`, [sender]);
            const [r] = await q(`SELECT coalesce(sum(original_amount),0)::float o FROM wallet_balances WHERE wallet_id=$1`, [receiver]);
            const [refs] = await q(`SELECT coalesce(sum(amount_used),0)::float u FROM transaction_balance_reference WHERE transaction_id = ANY($1)`, [
                txs,
            ]);
            report.push(
                `consistency conc=${conc}: sender.available=${s.a} (expect 0) receiver.original=${r.o} (expect ${events * perEvent}) refs.used=${refs.u} (expect ${events * perEvent})`,
            );
            expect(s.a).toBe(0);
            expect(r.o).toBe(events * perEvent);
            expect(refs.u).toBe(events * perEvent);
        }
    });
});
