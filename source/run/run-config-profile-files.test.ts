import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    configFixtureCwd,
    createSingleConfigModuleLoader
} from '../test-support/run-config-module-loader.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunProfileFiles } from './run-types.ts';

type LoadedConfig = LoadedRunConfig;
type ExpectedProfileFiles = {
    readonly exclude: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};

async function loadConfigValue(config: unknown): Promise<LoadedConfig> {
    const loadRunConfig = createSingleConfigModuleLoader('overkill.config.js', { config });

    return await loadRunConfig({ configPath: null, cwd: configFixtureCwd });
}

function assertProfileFiles(
    files: RunProfileFiles | null,
    expected: ExpectedProfileFiles,
    scope: OverkillScope
): void {
    scope.require.notNull(files);
    scope.assert.deepEqual(files, expected);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config-profile-files.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes profile file discovery',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: {
                                include: [ 'source/**/*.test.ts' ]
                            }
                        },
                        safe: {
                            testFamily: 'microtest',
                            files: {
                                include: [ 'source/unit/**/*.test.ts' ],
                                exclude: [ 'source/unit/**/*.slow.test.ts' ]
                            }
                        }
                    }
                });
                const microtestProfile = config.profiles.microtest;
                const safeProfile = config.profiles.safe;

                scope.require.defined(microtestProfile);
                scope.require.defined(safeProfile);
                assertProfileFiles(microtestProfile.files, {
                    exclude: [],
                    include: [ 'source/**/*.test.ts' ]
                }, scope);
                assertProfileFiles(safeProfile.files, {
                    exclude: [ 'source/unit/**/*.slow.test.ts' ],
                    include: [ 'source/unit/**/*.test.ts' ]
                }, scope);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid profile file globs',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    include: [ 'source/**/*.test.ts' ],
                                    exclude: [ '!source/**/*.slow.test.ts' ]
                                }
                            }
                        }
                    });
                }, {
                    message: /negated glob patterns are not supported/
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            files: {
                                sets: {
                                    unit: {
                                        include: [ 'source/unit/**/*.test.ts' ]
                                    },
                                    integration: {
                                        include: [ 'source/integration/**/*.test.ts' ],
                                        exclude: [ 'source/integration/**/*.slow.test.ts' ]
                                    }
                                }
                            }
                        }
                    }
                });
                const microtestProfile = config.profiles.microtest;

                scope.require.defined(microtestProfile);
                scope.require.notNull(microtestProfile.files);
                scope.assert.deepEqual(microtestProfile.files, {
                    sets: {
                        integration: {
                            exclude: [ 'source/integration/**/*.slow.test.ts' ],
                            include: [ 'source/integration/**/*.test.ts' ]
                        },
                        unit: {
                            exclude: [],
                            include: [ 'source/unit/**/*.test.ts' ]
                        }
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid profile file sets',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadMixedFilePolicy() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    include: [ 'source/**/*.test.ts' ],
                                    sets: {
                                        unit: { include: [ 'source/unit/**/*.test.ts' ] }
                                    }
                                }
                            }
                        }
                    });
                }, { message: /invalid value: expected never/ });
                await scope.assert.rejects(async function loadEmptyFileSets() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: { sets: {} }
                            }
                        }
                    });
                }, { message: 'Invalid profile files.sets: at least one file set is required.' });
                await scope.assert.rejects(async function loadInvalidFileSetName() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    sets: {
                                        'unit tests': { include: [ 'source/unit/**/*.test.ts' ] }
                                    }
                                }
                            }
                        }
                    });
                }, { message: /Invalid profile file set name "unit tests"/ });
                await scope.assert.rejects(async function loadInvalidFileSetGlob() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                files: {
                                    sets: {
                                        unit: {
                                            exclude: [ '!source/**/*.slow.test.ts' ],
                                            include: [ 'source/unit/**/*.test.ts' ]
                                        }
                                    }
                                }
                            }
                        }
                    });
                }, { message: /files\.sets\.unit\.exclude negated glob patterns are not supported/ });

                return scope.assert.collect();
            }
        })
    ]
});
