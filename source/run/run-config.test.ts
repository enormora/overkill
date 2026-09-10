import {
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
    type LoadedRunConfig
} from './run-config.ts';

type LoadedConfig = LoadedRunConfig;
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

function assertDefaultMicrotestResourceUsage(scope: OverkillScope, config: LoadedConfig): void {
    const profile = config.profiles.microtest;

    scope.require.defined(profile);
    scope.assert.deepEqual(profile.resourceUsage, defaultMicrotestProfile().resourceUsage);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-config.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'defineConfig() returns the project config unchanged',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const projectConfig = { runtimeStateDir: 'target/overkill-state' };

                scope.assert.equal(defineConfig(projectConfig), projectConfig);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() returns defaults when no config exists',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() discovers a native TypeScript named config export',
            annotations: {},
            controls: {},
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
                assertDefaultMicrotestResourceUsage(scope, config);
                scope.assert.equal(config.reporters, null);
                scope.assert.equal(config.runtimeStateDir, 'target/overkill-state');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() discovers a JavaScript named config export',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({ runtimeStateDir: 'target/js-config-state' });

                scope.assert.equal(config.configPath, resolvedConfigFixturePath('overkill.config.js'));
                scope.assert.equal(config.runtimeStateDir, 'target/js-config-state');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() loads microtest resource usage policy',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
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
                            }
                        }
                    }
                });
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes named profile overrides',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
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
                                budgets: { residentSetBytes: null }
                            },
                            timeouts: { hardMilliseconds: 2000 }
                        }
                    }
                });
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() normalizes unmeasured named profile overrides',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() inherits unmeasured named profile defaults',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const config = await loadConfigValue({
                    profiles: {
                        safe: {
                            testFamily: 'microtest',
                            resourceUsage: { measure: false }
                        }
                    }
                });
                const profile = config.profiles.safe;

                scope.require.defined(profile);
                scope.assert.deepEqual(profile, defaultMicrotestProfile());

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects unknown config keys',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({ include: [ 'source' ] });
                }, { message: /unexpected additional property: "include"/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects profiles without a test family',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects unsupported profile test families',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            backend: { testFamily: 'property' }
                        }
                    });
                }, { message: /testFamily/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects resource budgets without measurement',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid resource usage numbers',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
                        profiles: {
                            microtest: {
                                testFamily: 'microtest',
                                resourceUsage: {
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects unknown microtest profile keys',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function loadInvalidConfig() {
                    await loadConfigValue({
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
                    });
                }, { message: /unexpected additional property/ });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'loadRunConfig() rejects invalid profile names',
            annotations: {},
            controls: {},
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
