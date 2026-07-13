import { baseConfig } from '@enormora/eslint-config-base';
import { nodeConfig, nodeConfigFileConfig, nodeEntryPointFileConfig } from '@enormora/eslint-config-node';
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
            'import/extensions': 'off',
            'no-duplicate-imports': 'off',
            'restricted-syntax/no-empty-function-body': 'off'
        }
    },
    {
        files: [ '**/*.test.ts' ],
        rules: {
            '@stylistic/max-len': 'off',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-magic-numbers': 'off',
            '@typescript-eslint/no-unsafe-type-assertion': 'off',
            '@typescript-eslint/only-throw-error': 'off',
            'no-throw-literal': 'off'
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
        files: [ 'source/packages/**/*.ts' ],
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
