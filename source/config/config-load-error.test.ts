import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createConfigLoader
} from './config.ts';
import { ConfigError } from './config-error.ts';

const loadConfig = createConfigLoader({
    async fileExists() {
        return false;
    },
    async importModule() {
        throw new Error('Cannot import config.');
    }
});

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/config/config-load-error.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadConfig() reports explicit config import failures',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadMissingConfig() {
                    await loadConfig({ configPath: 'missing.config.js', cwd: '/project' });
                }, {
                    type: ConfigError,
                    message: /Failed to load config file/
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode, { reporters: [ createOverkillLineReporter() ] });
