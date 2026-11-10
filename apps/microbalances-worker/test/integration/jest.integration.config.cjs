const base = require('../../../../jest.config.cjs');

/** Integration runs hit the local PostgreSQL, so they use their own match (*.int.ts) and never run with `pnpm test`. */
module.exports = {
    ...base,
    rootDir: '../../../..',
    roots: ['<rootDir>/apps/microbalances-worker/test/integration'],
    testMatch: ['**/*.int.ts'],
    collectCoverageFrom: undefined,
    coverageThreshold: undefined,
    testTimeout: 900000,
};
