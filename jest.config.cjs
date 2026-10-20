const { compilerOptions } = require('./tsconfig.json');
const moduleNameMapper = Object.fromEntries(
    Object.entries(compilerOptions.paths).map(([alias, targets]) => [
        '^' + alias.replace('*', '(.*)') + '$',
        '<rootDir>/' + targets[0].replace('*', '$1'),
    ]),
);
module.exports = {
    roots: ['<rootDir>/apps'],
    testMatch: ['**/*.spec.ts'],
    testEnvironment: 'node',
    setupFiles: ['reflect-metadata'],
    cacheDirectory: '<rootDir>/.cache/jest',
    moduleNameMapper,
    transform: {
        '^.+\\.ts$': [
            '@swc/jest',
            {
                swcrc: false,
                jsc: {
                    parser: { syntax: 'typescript', decorators: true },
                    transform: { legacyDecorator: true, decoratorMetadata: true },
                    target: 'es2021',
                },
                module: { type: 'commonjs' },
            },
        ],
    },
    transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/|@commodo-sas/shared-libs/)'],
    collectCoverageFrom: ['apps/**/src/**/*.ts', '!apps/**/src/**/*.spec.ts'],
    coverageProvider: 'v8',
    coverageThreshold: {
        './apps/microbalances-worker/src/application/': { lines: 80, branches: 80 },
    },
    coverageReporters: ['text', 'lcov'],
};
