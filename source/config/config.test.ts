import { runIfMain } from '#test-runner';

import { selectTestProfile } from '../run/test-profile.ts';
import {
    defaultFailureArtifactPolicy,
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createReportingContext } from '../engine/reporting-context.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import {
    configFixtureCwd,
    createConfigModuleLoader,
    createSingleConfigModuleLoader,
    resolvedConfigFixturePath
} from '../test-support/run-config-module-loader.ts';
import {
    defineConfig,
    type LoadedConfig
} from './config.ts';
import { normalizeCoveragePolicy } from './profile-normalization.ts';
import type { MicrotestProfileConfig, ProfileConfig } from './types.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

type ConfigModule = {
    readonly config: unknown;
};

function configModule(config: unknown): ConfigModule {
    return { config };
}

async function loadConfigFromModule(fileName: string, module: unknown): Promise<LoadedConfig> {
    return await createSingleConfigModuleLoader(fileName, module)({ configPath: null, cwd: configFixtureCwd });
}

async function loadConfigValue(config: unknown): Promise<LoadedConfig> {
    return await loadConfigFromModule('overkill.config.js', configModule(config));
}

function assertDefaultMicrotestProcessUsage(scope: OverkillScope, config: LoadedConfig): void {
    const profile = selectTestProfile('microtest', config);

    scope.require.defined(profile);
    scope.assert.deepEqual(profile.processUsage, defaultMicrotestProfile().processUsage);
}

function assertProfileTiming(
    scope: OverkillScope,
    config: LoadedConfig,
    profileName: string,
    collection: 'precise' | 'summary'
): void {
    const profile = selectTestProfile(profileName, config);

    scope.require.defined(profile);
    scope.assert.deepEqual(profile.timings, { collection });
}

function requireMicrotestProfile(
    scope: OverkillScope,
    profile: ProfileConfig | undefined
): MicrotestProfileConfig {
    scope.require.defined(profile);

    if (profile.testFamily !== 'microtest') {
        throw new TypeError('Expected a microtest profile.');
    }

    return profile;
}

export const testNode = createOverkillSuite({
    ...metadata,

    title: 'source/config/config.test.ts',

    children: [
        createOverkillTestCase({
            ...metadata,

            title: 'defineConfig() returns the project config unchanged',

            body(scope: OverkillScope) {
                const projectConfig = { runtimeStateDir: 'target/overkill-state' };

                scope.assert.equal(defineConfig(projectConfig), projectConfig);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() returns defaults when no config exists',

            async body(scope: OverkillScope) {
                const config = await createConfigModuleLoader({})({ configPath: null, cwd: configFixtureCwd });

                scope.assert.equal(config.configPath, null);
                scope.assert.deepEqual(config.loader, { sourceMaps: false, stripMode: 'strip-only' });
                scope.assert.equal(
                    typeof config.outputRenderer(createReportingContext({ projectRoot: null })).render,
                    'function'
                );
                scope.assert.deepEqual(config.profiles, {
                    microtest: defaultMicrotestProfile()
                });
                scope.assert.equal(config.reporters, null);
                scope.assert.equal(config.runtimeStateDir, '.overkill');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() normalizes microtest coverage policy',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        microtest: {
                            coverage: {
                                outputDir: 'target/coverage',
                                outputs: [ 'text', 'json', 'text' ],
                                sources: {
                                    exclude: [ '**/*.generated.ts' ],
                                    include: [ 'source/**/*.ts' ],
                                    mode: 'all'
                                },
                                thresholds: { branches: 70, functions: 80, lines: 90 }
                            },
                            testFamily: 'microtest'
                        },
                        loaded: {
                            coverage: {
                                outputDir: '/overkill-project/absolute-coverage',
                                sources: { mode: 'loaded' }
                            },
                            testFamily: 'microtest'
                        },
                        raw: {
                            coverage: { outputs: [] },
                            testFamily: 'microtest'
                        }
                    }
                });
                const microtestProfile = requireMicrotestProfile(scope, config.profiles.microtest);
                const loadedProfile = requireMicrotestProfile(scope, config.profiles.loaded);
                const rawProfile = requireMicrotestProfile(scope, config.profiles.raw);

                scope.assert.deepEqual(microtestProfile.coverage, {
                    outputDirectory: resolvedConfigFixturePath('target/coverage'),
                    outputs: [ 'text', 'json' ],
                    sources: {
                        exclude: [ '**/*.generated.ts' ],
                        include: [ 'source/**/*.ts' ],
                        mode: 'all'
                    },
                    thresholds: { branches: 70, functions: 80, lines: 90 }
                });
                scope.assert.deepEqual(rawProfile.coverage, {
                    outputDirectory: null,
                    outputs: [],
                    sources: { exclude: [], mode: 'loaded' },
                    thresholds: { branches: null, functions: null, lines: null }
                });
                scope.assert.deepEqual(loadedProfile.coverage, {
                    outputDirectory: '/overkill-project/absolute-coverage',
                    outputs: [ 'v8', 'lcov' ],
                    sources: { exclude: [], mode: 'loaded' },
                    thresholds: { branches: null, functions: null, lines: null }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'coverage output directories require a loaded config file',

            body(scope: OverkillScope) {
                scope.assert.throws(function normalizeOutputWithoutConfig() {
                    normalizeCoveragePolicy({ outputDir: 'coverage' }, null);
                }, { message: 'Coverage outputDir requires a loaded config file.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() normalizes timing policies',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        precise: {
                            failureArtifacts: defaultFailureArtifactPolicy,
                            testFamily: 'microtest',
                            timings: { collection: 'precise' }
                        },
                        summary: {
                            failureArtifacts: defaultFailureArtifactPolicy,
                            testFamily: 'microtest',
                            timings: { collection: 'summary' }
                        }
                    }
                });
                assertProfileTiming(scope, config, 'microtest', 'summary');
                assertProfileTiming(scope, config, 'precise', 'precise');
                assertProfileTiming(scope, config, 'summary', 'summary');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() discovers a native TypeScript named config export',

            async body(scope: OverkillScope) {
                const config = await loadConfigFromModule(
                    'overkill.config.ts',
                    configModule({
                        loader: { sourceMaps: true, stripMode: 'strip-only' },
                        runtimeStateDir: 'target/overkill-state'
                    })
                );

                scope.assert.equal(config.configPath, resolvedConfigFixturePath('overkill.config.ts'));
                scope.assert.deepEqual(config.loader, { sourceMaps: true, stripMode: 'strip-only' });
                assertDefaultMicrotestProcessUsage(scope, config);
                scope.assert.equal(config.reporters, null);
                scope.assert.equal(config.runtimeStateDir, 'target/overkill-state');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() discovers a JavaScript named config export',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({ runtimeStateDir: 'target/js-config-state' });

                scope.assert.equal(config.configPath, resolvedConfigFixturePath('overkill.config.js'));
                scope.assert.equal(config.runtimeStateDir, 'target/js-config-state');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() loads microtest process usage policy',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            processUsage: {
                                measure: true,
                                budgets: {
                                    activeResourceCount: 4,
                                    javaScriptEngineHeapBytes: 100,
                                    residentSetBytes: 200,
                                    residentSetGrowthBytesPerSecond: 50
                                },
                                samplingIntervalMilliseconds: 25
                            }
                        }
                    }
                });
                const profile = selectTestProfile('microtest', config);

                scope.require.defined(profile);
                scope.assert.deepEqual(
                    profile,
                    defaultMicrotestProfile({
                        processUsage: {
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
            ...metadata,

            title: 'loadConfig() normalizes named profile overrides',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        microtest: {
                            testFamily: 'microtest',
                            processUsage: {
                                measure: true,
                                samplingIntervalMilliseconds: 25
                            }
                        },
                        safe: {
                            testFamily: 'microtest',
                            execution: {
                                maxConcurrency: 'unlimited',
                                processModel: 'in-process',
                                scheduling: 'serial'
                            },
                            processUsage: {
                                measure: true,
                                budgets: { residentSetBytes: null }
                            },
                            timeouts: { hardMilliseconds: 2000 }
                        }
                    }
                });
                const profile = selectTestProfile('safe', config);

                scope.require.defined(profile);
                scope.assert.deepEqual(
                    profile,
                    defaultMicrotestProfile({
                        execution: {
                            maxConcurrency: 'unlimited',
                            processModel: 'in-process',
                            scheduling: 'serial'
                        },
                        processUsage: {
                            budgets: { residentSetBytes: null },
                            measure: true
                        },
                        timeouts: { hardMilliseconds: 2000 }
                    })
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() normalizes unmeasured named profile overrides',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        safe: {
                            testFamily: 'microtest',
                            timeouts: {
                                hardMilliseconds: 2000,
                                softMilliseconds: 300
                            }
                        }
                    }
                });
                const profile = selectTestProfile('safe', config);

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
            ...metadata,

            title: 'loadConfig() inherits unmeasured named profile defaults',

            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        safe: {
                            testFamily: 'microtest',
                            processUsage: { measure: false }
                        }
                    }
                });
                const profile = selectTestProfile('safe', config);

                scope.require.defined(profile);
                scope.assert.deepEqual(profile, defaultMicrotestProfile());

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects unknown config keys',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({ include: [ 'source' ] });
                }, { message: /unexpected additional property: "include"/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects profiles without a test family',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: { microtest: {} }
                    });
                }, { message: /testFamily/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects unsupported profile test families',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            backend: { testFamily: 'unknown-family' }
                        }
                    });
                }, { message: /testFamily/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects process budgets without measurement',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                processUsage: {
                                    budgets: { residentSetBytes: 200 }
                                }
                            }
                        }
                    });
                }, { message: /Invalid config file/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects invalid process usage numbers',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                processUsage: {
                                    measure: true,
                                    samplingIntervalMilliseconds: 0
                                }
                            }
                        }
                    });
                }, { message: /positive safe integer/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects unknown microtest profile keys',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                processUsage: {
                                    measure: true,
                                    budgets: {}
                                },
                                unknownPolicy: true
                            }
                        }
                    });
                }, { message: /unexpected additional property/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'loadConfig() rejects invalid profile names',

            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            'backend/http': { testFamily: 'microtest' }
                        }
                    });
                }, { message: /Invalid profile name "backend\/http"/ });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
