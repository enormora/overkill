import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { loadRunConfig } from './run-config.ts';

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-'));
}

async function writeConfig(folder: string, source: string): Promise<void> {
    await fs.writeFile(path.join(folder, 'overkill.config.js'), source, 'utf8');
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-integration-profile.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes integration profile defaults',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    `export const config = {
                        profiles: {
                            service: {
                                testFamily: 'integration',
                                files: { include: [ 'source/**/*.integration.test.ts' ] }
                            }
                        }
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });
                const profile = config.profiles.service;
                const microtestProfile = config.profiles.microtest;

                scope.require.defined(profile);
                scope.require.defined(microtestProfile);
                scope.assert.deepEqual(profile, {
                    execution: {
                        processModel: 'supervised-process',
                        scheduling: 'concurrent'
                    },
                    files: {
                        exclude: [],
                        include: [ 'source/**/*.integration.test.ts' ]
                    },
                    reporters: null,
                    resourceUsage: defaultMicrotestProfile().resourceUsage,
                    testFamily: 'integration',
                    timeouts: {
                        collectionMilliseconds: 5000,
                        hardMilliseconds: 7000,
                        softMilliseconds: 5000
                    }
                });
                scope.assert.deepEqual(microtestProfile, defaultMicrotestProfile());

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes integration execution overrides',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    `export const config = {
                        profiles: {
                            service: {
                                testFamily: 'integration',
                                files: { include: [ 'source/**/*.integration.test.ts' ] },
                                execution: {
                                    processModel: 'supervised-process',
                                    scheduling: 'serial'
                                }
                            }
                        }
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });
                const profile = config.profiles.service;

                scope.require.defined(profile);
                scope.assert.deepEqual(profile.execution, {
                    processModel: 'supervised-process',
                    scheduling: 'serial'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
