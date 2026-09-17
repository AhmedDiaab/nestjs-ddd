import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    // ignores
    globalIgnores([
        'eslint.config.mjs',
        '**/dist/**',
        '**/node_modules/**',
        '**/build/**',
        '**/coverage/**',
    ]),

    // base js
    eslint.configs.recommended,

    // TS
    ...tseslint.configs.recommendedTypeChecked,

    // 🔌 eslint-plugin-import FLAT configs (not legacy)
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,

    // prettier last
    eslintPluginPrettierRecommended,

    // project rules
    {
        files: ['**/*.ts'],
        languageOptions: {
            sourceType: 'module',
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        settings: {
            'import/resolver': {
                // Use TS resolver so aliases work
                typescript: {
                    // Point to the tsconfig(s) that define "paths"
                    // If you have a base config, list both.
                    project: [
                        './tsconfig.json', // or ./tsconfig.base.json
                        // './tsconfig.eslint.json', // if you create one (see below)
                    ],
                    alwaysTryTypes: true,
                },
                // Fallback to node resolution for non-TS packages
                node: {
                    extensions: ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.json'],
                },
            },
        },
        rules: {
            // TS hygiene
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-floating-promises': 'warn',
            '@typescript-eslint/no-unsafe-argument': 'warn',
            '@typescript-eslint/consistent-type-imports': ['warn', { prefer: 'type-imports' }],

            // Import rules
            'import/no-unresolved': 'error',
            'import/no-cycle': ['error', { ignoreExternal: true }],

            // If you use @ianvs/prettier-plugin-sort-imports, let Prettier handle sorting:
            'import/order': 'off',
        },
    },

    // layer boundaries: dependencies point inward (interface → application → domain)
    {
        files: ['src/application/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@infrastructure',
                                '@infrastructure/*',
                                '@interface',
                                '@interface/*',
                            ],
                            message:
                                'Application depends on ports (application/ports), not adapters.',
                        },
                        {
                            group: ['oracledb', 'pg', 'mysql2', 'mssql', 'express', 'passport*'],
                            message: 'Keep drivers and HTTP libraries in infrastructure/interface.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/domain/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@application',
                                '@application/*',
                                '@infrastructure',
                                '@infrastructure/*',
                                '@interface',
                                '@interface/*',
                                '@nestjs/*',
                            ],
                            message:
                                'Domain is framework-free and depends on nothing outside itself and @shared.',
                        },
                    ],
                },
            ],
        },
    },
]);
