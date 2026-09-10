import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { loadRunConfig } from './run-config.ts';

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-timeouts-'));
}

async function writeConfig(folder: string, source: string): Promise<void> {
    await fs.writeFile(path.join(folder, 'overkill.config.js'), source, 'utf8');
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-timeouts.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects profile soft timeouts greater than hard timeouts',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    `export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                timeouts: {
                                    hardMilliseconds: 100,
                                    softMilliseconds: 200
                                }
                            }
                        }
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /softMilliseconds must be less than or equal to hardMilliseconds/
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
