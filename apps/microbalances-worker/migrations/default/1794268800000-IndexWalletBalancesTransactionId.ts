import { MigrationInterface, QueryRunner } from 'typeorm';

const INDEX_NAME = 'idx_wallet_balances_transaction_id';

/**
 * Indexes wallet_balances.transaction_id, which this worker reads on every billing child movement (antecedent settled
 * check) and which the foreign key to transactions also needs when a transaction is deleted. Without it each lookup
 * scans the whole table (about 177 ms over 214 thousand rows in the local database, 0.135 ms with the index).
 * It is built CONCURRENTLY so writers are not blocked, so it must run outside a transaction.
 */
export class IndexWalletBalancesTransactionId1794268800000 implements MigrationInterface {
    /** CONCURRENTLY cannot run inside a transaction. */
    transaction = false;

    /**
     * Creates the index, first dropping an INVALID leftover of an interrupted concurrent build, since IF NOT EXISTS would keep it.
     * @param queryRunner - Query runner without an active transaction.
     */
    async up(queryRunner: QueryRunner): Promise<void> {
        const invalid = await queryRunner.query(
            `SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1 AND NOT i.indisvalid`,
            [INDEX_NAME],
        );
        if (invalid.length > 0) await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${INDEX_NAME}`);
        await queryRunner.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME} ON public.wallet_balances (transaction_id)`);
    }

    /**
     * Drops the index; dropping an index loses no data.
     * @param queryRunner - Query runner without an active transaction.
     */
    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS public.${INDEX_NAME}`);
    }
}
