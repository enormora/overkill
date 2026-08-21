import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import { defineConfig, loadRunConfig, RunConfigError } from './run-config.ts';

async function createTempFolder(): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), 'overkill-run-config-'));
}

async function writeConfig(folder: string, fileName: string, source: string): Promise<string> {
    const filePath = path.join(folder, fileName);

    await fs.writeFile(filePath, source, 'utf8');

    return filePath;
}

type LoadedConfig = Awaited<ReturnType<typeof loadRunConfig>>;

function assertDefaultMicrotestResourceUsage(scope: OverkillScope, config: LoadedConfig): void {
    const profile = config.profiles.microtest;

    scope.require.defined(profile);
    scope.assert.deepEqual(profile.resourceUsage, defaultMicrotestProfile().resourceUsage);
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-config.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'defineConfig() returns the project config unchanged',
            metadata: {},
            body(scope: OverkillScope) {
                const projectConfig = { runtimeStateDir: 'target/overkill-state' };

                scope.assert.equal(defineConfig(projectConfig), projectConfig);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() returns defaults when no config exists',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                const config = await loadRunConfig({ configPath: null, cwd });

                scope.assert.equal(config.configPath, null);
                scope.assert.deepEqual(config.loader, { sourceMaps: false, stripMode: 'strip-only' });
                scope.assert.equal(typeof config.outputRenderer.render, 'function');
                scope.assert.deepEqual(config.profiles, {
                    microtest: defaultMicrotestProfile()
                });
                scope.assert.equal(config.reporters, null);
                scope.assert.equal(config.runtimeStateDir, '.overkill');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() discovers a native TypeScript named config export',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                const configPath = await writeConfig(
                    cwd,
                    'overkill.config.ts',
                    `export const config = {
                        loader: { sourceMaps: true, stripMode: 'strip-only' },
                        runtimeStateDir: 'target/overkill-state'
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });

                scope.assert.equal(config.configPath, configPath);
                scope.assert.deepEqual(config.loader, { sourceMaps: true, stripMode: 'strip-only' });
                assertDefaultMicrotestResourceUsage(scope, config);
                scope.assert.equal(config.reporters, null);
                scope.assert.equal(config.runtimeStateDir, 'target/overkill-state');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() loads microtest resource usage policy',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
                                    measure: true,
                                    budgets: {
                                        activeResourceCount: 4,
                                        javaScriptEngineHeapBytes: 100,
                                        residentSetBytes: 200,
                                        residentSetGrowthBytesPerSecond: 50
                                    },
                                    samplingIntervalMilliseconds: 25
                                },
                            }
                        }
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });
                const profile = config.profiles.microtest;

                scope.require.defined(profile);
                scope.assert.deepEqual(
                    profile,
                    defaultMicrotestProfile({
                        resourceUsage: {
                            budgets: {
                                activeResourceCount: 4,
                                javaScriptEngineHeapBytes: 100,
                                residentSetBytes: 200,
                                residentSetGrowthBytesPerSecond: 50
                            },
                            measure: true,
                            samplingIntervalMilliseconds: 25
                        }
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() normalizes named profile overrides',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
                                    measure: true,
                                    samplingIntervalMilliseconds: 25
                                }
                            },
                            safe: {
                                testFamily: 'microtest',
                                execution: {
                                    processModel: 'in-process',
                                    scheduling: 'serial'
                                },
                                resourceUsage: {
                                    measure: true,
                                    budgets: {
                                        residentSetBytes: null
                                    }
                                },
                                timeouts: {
                                    hardMilliseconds: 2000
                                }
                            }
                        }
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });
                const profile = config.profiles.safe;

                scope.require.defined(profile);
                scope.assert.deepEqual(
                    profile,
                    defaultMicrotestProfile({
                        execution: {
                            processModel: 'in-process',
                            scheduling: 'serial'
                        },
                        resourceUsage: {
                            budgets: {
                                residentSetBytes: null
                            },
                            measure: true
                        },
                        timeouts: {
                            hardMilliseconds: 2000
                        }
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() normalizes unmeasured named profile overrides',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            safe: {
                                testFamily: 'microtest',
                                timeouts: {
                                    hardMilliseconds: 2000,
                                    softMilliseconds: 300
                                }
                            }
                        }
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });
                const profile = config.profiles.safe;

                scope.require.defined(profile);
                scope.assert.deepEqual(
                    profile,
                    defaultMicrotestProfile({
                        timeouts: {
                            hardMilliseconds: 2000,
                            softMilliseconds: 300
                        }
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() inherits unmeasured named profile defaults',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            safe: {
                                testFamily: 'microtest',
                                resourceUsage: {
                                    measure: false
                                }
                            }
                        }
                    };`
                );
                const config = await loadRunConfig({ configPath: null, cwd });
                const profile = config.profiles.safe;

                scope.require.defined(profile);
                scope.assert.deepEqual(profile, defaultMicrotestProfile());

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects unknown config keys',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(cwd, 'overkill.config.js', 'export const config = { include: ["source"] };');

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /unexpected additional property: "include"/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects resource budgets without measurement',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
                                    budgets: { residentSetBytes: 200 }
                                }
                            }
                        }
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /Invalid config file/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects invalid resource usage numbers',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
                                    measure: true,
                                    samplingIntervalMilliseconds: 0
                                }
                            }
                        }
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /positive safe integer/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects unknown microtest profile keys',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
                                    measure: true,
                                    budgets: {}
                                },
                                unknownPolicy: true
                            }
                        }
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /unexpected additional property/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects invalid profile names',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
                    `export const config = {
                        profiles: {
                            "backend/http": {
                                testFamily: 'microtest'
                            }
                        }
                    };`
                );

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /Invalid profile name "backend\/http"/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects an explicit empty reporter list',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(cwd, 'overkill.config.js', 'export const config = { reporters: [] };');

                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadRunConfig({ configPath: null, cwd });
                }, {
                    message: /at reporters\[0\]/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() rejects profile soft timeouts greater than hard timeouts',
            metadata: {},
            async body(scope: OverkillScope) {
                const cwd = await createTempFolder();
                await writeConfig(
                    cwd,
                    'overkill.config.js',
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
        }),
        createOverkillTestCase({
            name: 'loadRunConfig() reports explicit config import failures',
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
