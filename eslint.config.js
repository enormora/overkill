import { baseConfig } from '@enormora/eslint-config-base';
import { browserConfig } from '@enormora/eslint-config-browser';
import { nodeConfig, nodeConfigFileConfig, nodeEntryPointFileConfig } from '@enormora/eslint-config-node';
import { testSupportConfig } from '@enormora/eslint-config-test-base';
import { typescriptConfig } from '@enormora/eslint-config-typescript';

export default [
    {
        ignores: [ 'source/integration-tests/integration/fixtures/**/*.test.ts', 'target/**/*' ]
    },
    ...baseConfig,
    {
        ...nodeConfig,
        files: [ [ '**/*.{js,cjs,mjs,ts,cts,mts}', '!source/reporters/benchmark-html-browser.entry-point.ts' ] ]
    },
    {
        ...browserConfig,
        files: [ 'source/reporters/benchmark-html-browser.entry-point.ts' ]
    },
    {
        ...typescriptConfig,
        files: [ '**/*.ts' ],
        languageOptions: {
            ...typescriptConfig.languageOptions,
            parserOptions: {
                ...typescriptConfig.languageOptions.parserOptions,
                projectService: false,
                project: './source/tsconfig.eslint.json',
                tsconfigRootDir: import.meta.dirname
            }
        }
    },
    {
        files: [ 'source/reporters/benchmark-html-browser.entry-point.ts' ],
        languageOptions: { parserOptions: { project: './source/tsconfig.eslint-browser.json' } }
    },
    {
        ...testSupportConfig,
        files: [ '**/*.test.ts', 'source/integration-tests/*/support/**/*.ts' ]
    },
    {
        files: [ 'source/**/*.test.ts', 'source/test-support/**/*.ts', 'source/integration-tests/*/support/**/*.ts' ],
        ignores: [ '**/*.type-test.ts' ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [ 'error', {
                patterns: [ {
                    group: [ './**', '../**' ],
                    importNames: [
                        'TestScope',
                        'ParameterizedTestScope',
                        'TestScopeAssertContext',
                        'TestRandom',
                        'TestBody',
                        'ThrowingTestScope',
                        'ThrowingTestBody'
                    ],
                    message: 'Import test framework types from @overkill-dev/test or its compatibility subpath.'
                } ]
            } ],
            'no-restricted-syntax': [ 'error', {
                selector:
                    'ImportDeclaration[source.value="@overkill-dev/test"] > ImportSpecifier[imported.name="suite"]:not([local.name="suite"])',
                message: 'Use the published suite author without an alias.'
            }, {
                selector:
                    'ImportDeclaration[source.value="@overkill-dev/test"] > ImportSpecifier[imported.name="test"]:not([local.name="test"])',
                message: 'Use the published test author without an alias.'
            }, {
                selector:
                    'ImportDeclaration[source.value="#tests"] > ImportSpecifier[imported.name="suite"]:not([local.name="suite"])',
                message: 'Use the published suite author without an alias.'
            }, {
                selector:
                    'ImportDeclaration[source.value="#tests"] > ImportSpecifier[imported.name="test"]:not([local.name="test"])',
                message: 'Use the published test author without an alias.'
            } ]
        }
    },
    {
        files: [ 'source/**/*.ts' ],
        ignores: [ '**/*.test.ts', '**/*.type-test.ts', 'source/test-support/**' ],
        rules: {
            '@typescript-eslint/no-restricted-imports': [ 'error', {
                paths: [
                    {
                        name: '@enormora/clock',
                        importNames: [ 'createDeterministicClock', 'DeterministicClock' ],
                        message: 'Use createClock() outside tests and test-support files.'
                    },
                    {
                        name: '@enormora/clock/deterministic-clock',
                        message: 'Use a real clock outside tests and test-support files.'
                    }
                ]
            } ]
        }
    },
    {
        ...nodeConfigFileConfig,
        files: [ 'dependency-cruiser.config.js', 'eslint.config.js', 'overkill.config.ts' ]
    },
    {
        ...nodeEntryPointFileConfig,
        files: [ 'packtory.config.js' ],
        rules: {
            ...nodeConfigFileConfig.rules,
            ...nodeEntryPointFileConfig.rules
        }
    },
    {
        ...nodeEntryPointFileConfig,
        files: [ 'source/packages/**/*.entry-point.ts' ],
        rules: {
            ...nodeEntryPointFileConfig.rules,
            'no-barrel-files/no-barrel-files': 'off'
        }
    }
];
