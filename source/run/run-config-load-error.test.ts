import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { loadRunConfig, RunConfigError } from './run-config.ts';

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-'));
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-load-error.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() reports explicit config import failures',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();

                await scope.assert.rejects(async function loadMissingConfig() {
                    await loadRunConfig({ configPath: 'missing.config.js', cwd });
                }, {
                    type: RunConfigError,
                    message: /Failed to load config file/
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode, { reporters: [ createOverkillLineReporter() ] });
