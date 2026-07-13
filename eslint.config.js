import { baseConfig } from '@enormora/eslint-config-base';
import { nodeConfig, nodeConfigFileConfig, nodeEntryPointFileConfig } from '@enormora/eslint-config-node';
import { testSupportConfig } from '@enormora/eslint-config-test-base';
import { typescriptConfig } from '@enormora/eslint-config-typescript';

export default [
    {
        ignores: [ 'target/**/*' ]
    },
    ...baseConfig,
    {
        ...nodeConfig,
        files: [ '**/*.{js,cjs,mjs,ts,cts,mts}' ]
    },
    {
        ...typescriptConfig,
        files: [ '**/*.ts' ]
    },
    {
        files: [ '**/*.ts' ],
        rules: {
            'restricted-syntax/no-empty-function-body': 'off'
        }
    },
    {
        ...testSupportConfig,
        files: [ '**/*.test.ts' ],
        rules: {
            ...testSupportConfig.rules,
            '@typescript-eslint/no-floating-promises': [
                'error',
                {
                    allowForKnownSafeCalls: [
                        {
                            from: 'package',
                            name: 'test',
                            package: 'node:test'
                        }
                    ]
                }
            ]
        }
    },
    {
        ...nodeConfigFileConfig,
        files: [ 'eslint.config.js', 'packtory.config.js' ]
    },
    {
        files: [ 'packtory.config.js' ],
        rules: {
            'node/no-process-env': 'off',
            'node/no-sync': 'off'
        }
    },
    {
        ...nodeEntryPointFileConfig,
        files: [ 'source/packages/engine/entry-point.ts' ],
        rules: {
            ...nodeEntryPointFileConfig.rules,
            'no-barrel-files/no-barrel-files': 'off'
        }
    },
    {
        files: [ '**/*.md' ],
        rules: {
            'markdown/fenced-code-language': 'off',
            'markdown/no-duplicate-headings': 'off',
            'markdown-links/no-missing-path': 'off'
        }
    }
];
