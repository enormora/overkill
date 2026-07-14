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
        ...testSupportConfig,
        files: [ '**/*.test.ts' ]
    },
    {
        ...nodeConfigFileConfig,
        files: [ 'eslint.config.js' ]
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
        files: [ 'source/packages/engine/entry-point.ts' ],
        rules: {
            ...nodeEntryPointFileConfig.rules,
            'no-barrel-files/no-barrel-files': 'off'
        }
    }
];
