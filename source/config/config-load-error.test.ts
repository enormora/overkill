import { suite, test } from '@overkill-dev/test';

import { createConfigLoader } from './config-loader.ts';
import { ConfigError } from './config-error.ts';

const loadConfig = createConfigLoader({
    async fileExists() {
        return false;
    },
    async importModule() {
        throw new Error('Cannot import config.');
    }
});

export const testNode = suite('Configuration load error', [
    test('reports explicit config import failures', async function (scope) {
        await scope.assert.rejects(async function loadMissingConfig() {
            await loadConfig({ configPath: 'missing.config.js', cwd: '/project' });
        }, {
            type: ConfigError,
            message: /Failed to load config file/
        });

        return scope.assert.collect();
    })
]);
