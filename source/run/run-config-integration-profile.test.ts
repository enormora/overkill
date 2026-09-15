import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import {
    configFixtureCwd,
    createSingleConfigModuleLoader
} from '../test-support/run-config-module-loader.ts';
import type { LoadedRunConfig } from './run-config.ts';

async function loadConfigValue(config: unknown): Promise<LoadedRunConfig> {
    const loadRunConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadRunConfig({ configPath: null, cwd: configFixtureCwd });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-integration-profile.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes integration profile defaults',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        service: {
                            testFamily: 'integration',
                            files: { include: [ 'source/**/*.integration.test.ts' ] }
                        }
                    }
                });
                const profile = config.profiles.service;
                const microtestProfile = config.profiles.microtest;

                scope.require.defined(profile);
                scope.require.defined(microtestProfile);
                scope.assert.deepEqual(profile, {
                    execution: {
                        hostProcess: { kind: 'direct' },
                        processModel: 'worker-pool',
                        scheduling: 'concurrent',
                        workDistribution: { mode: 'file' },
                        workerLifecycle: 'reuse'
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
            title: 'loadRunConfig() normalizes worker-pool lifecycle and distribution overrides',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        defaultedService: {
                            testFamily: 'integration',
                            files: { include: [ 'source/**/*.integration.test.ts' ] },
                            execution: {
                                processModel: 'worker-pool',
                                scheduling: 'serial'
                            }
                        },
                        service: {
                            testFamily: 'integration',
                            files: {
                                sets: {
                                    integration: { include: [ 'source/**/*.integration.test.ts' ] }
                                }
                            },
                            execution: {
                                processModel: 'worker-pool',
                                scheduling: 'serial',
                                workDistribution: {
                                    groups: [
                                        { fileSets: [ 'integration' ], name: 'integration' }
                                    ],
                                    mode: 'group'
                                },
                                workerLifecycle: 'fresh-worker-per-unit'
                            }
                        }
                    }
                });
                const defaultedProfile = config.profiles.defaultedService;
                const profile = config.profiles.service;

                scope.require.defined(defaultedProfile);
                scope.require.defined(profile);
                scope.assert.deepEqual(defaultedProfile.execution, {
                    hostProcess: { kind: 'direct' },
                    processModel: 'worker-pool',
                    scheduling: 'serial',
                    workDistribution: { mode: 'file' },
                    workerLifecycle: 'reuse'
                });
                scope.assert.deepEqual(profile.execution, {
                    hostProcess: { kind: 'direct' },
                    processModel: 'worker-pool',
                    scheduling: 'serial',
                    workDistribution: {
                        groups: [
                            { fileSets: [ 'integration' ], name: 'integration' }
                        ],
                        mode: 'group',
                        unmatched: 'reject'
                    },
                    workerLifecycle: 'fresh-worker-per-unit'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid grouped work distribution',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadGroupedWithoutFileSets() {
                    await loadConfigValue({
                        profiles: {
                            service: {
                                testFamily: 'integration',
                                files: { include: [ 'source/**/*.integration.test.ts' ] },
                                execution: {
                                    processModel: 'worker-pool',
                                    workDistribution: {
                                        groups: [ { fileSets: [ 'integration' ], name: 'integration' } ],
                                        mode: 'group'
                                    }
                                }
                            }
                        }
                    });
                }, { message: 'Grouped work distribution requires profile files.sets.' });
                await scope.assert.rejects(async function loadUnknownFileSetGroup() {
                    await loadConfigValue({
                        profiles: {
                            service: {
                                testFamily: 'integration',
                                files: {
                                    sets: {
                                        integration: { include: [ 'source/**/*.integration.test.ts' ] }
                                    }
                                },
                                execution: {
                                    processModel: 'worker-pool',
                                    workDistribution: {
                                        groups: [ { fileSets: [ 'slow' ], name: 'slow' } ],
                                        mode: 'group'
                                    }
                                }
                            }
                        }
                    });
                }, { message: 'Invalid work group "slow": unknown file set "slow".' });
                await scope.assert.rejects(async function loadDuplicateFileSetGroup() {
                    await loadConfigValue({
                        profiles: {
                            service: {
                                testFamily: 'integration',
                                files: {
                                    sets: {
                                        integration: { include: [ 'source/**/*.integration.test.ts' ] }
                                    }
                                },
                                execution: {
                                    processModel: 'worker-pool',
                                    workDistribution: {
                                        groups: [
                                            { fileSets: [ 'integration' ], name: 'first' },
                                            { fileSets: [ 'integration' ], name: 'second' }
                                        ],
                                        mode: 'group'
                                    }
                                }
                            }
                        }
                    });
                }, {
                    message: 'Invalid work group "second": file set "integration" is already assigned to "first".'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes integration execution overrides',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
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
                });
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
