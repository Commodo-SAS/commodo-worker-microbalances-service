const tseslint = require('typescript-eslint');

// Syntax-based lint; TypeScript validation runs once in the separate typecheck gate.
module.exports = tseslint.config(
    { ignores: ['node_modules/**', 'dist/**', '.cache/**', 'coverage/**', 'docs/reference/**'] },
    ...tseslint.configs.recommended,
    {
        files: ['**/*.js', '**/*.cjs'],
        languageOptions: { sourceType: 'commonjs' },
        rules: { '@typescript-eslint/no-require-imports': 'off' },
    },
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
            eqeqeq: ['error', 'always', { null: 'ignore' }],
            'no-eval': 'error',
        },
    },
    {
        // Legacy secret adapter receives the published library's untyped grouped config.
        files: ['apps/**/environment/microbalances-environment.utils.ts'],
        rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    {
        files: ['apps/**/domain/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@nestjs/*', '@aws-sdk/*', 'firebase-admin', 'typeorm', '**/infrastructure/**', '**/application/**'],
                            message: 'Domain must remain independent of framework and adapters.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['apps/**/application/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@aws-sdk/*', 'firebase-admin', 'typeorm', '**/infrastructure/**'],
                            message: 'Application must depend on ports, not infrastructure adapters.',
                        },
                    ],
                },
            ],
        },
    },
);
