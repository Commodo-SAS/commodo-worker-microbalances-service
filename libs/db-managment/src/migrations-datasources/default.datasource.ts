import 'dotenv/config';
import { EDatabaseConfig } from '@commodo-sas/shared-libs/core/core/enums/database-config.enum';
import { createMigrationDataSource } from '@commodo-sas/shared-libs/db-managment/migration-datasource.factory';

/**
 * DataSource of the TypeORM CLI for this worker's migrations (migration:show:default, migration:run:default, migration:revert:default).
 * The factory reads libs/db-managment/src/migrations/default relative to the working directory. The application never runs
 * migrations itself: synchronize and migrationsRun stay false. Migrations are applied without a wrapping transaction
 * because index builds use CONCURRENTLY.
 */
export default createMigrationDataSource({
    connectionName: EDatabaseConfig.DEFAULT,
    entities: [],
    migrationsDir: 'default',
    overrides: { migrationsTransactionMode: 'none' },
});
