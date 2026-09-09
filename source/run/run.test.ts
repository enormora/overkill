import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { testNode as runCollectionErrorReportingTestNode } from './run-collection-error-reporting.test.ts';
import { RunResolutionError } from './run-errors.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const microtestCaptureControlsFixturePath = 'source/integration-tests/run/fixtures/microtest-capture-controls.test.ts';

const defaultConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});
const supervisedCollectionConfig: RunConfig = defaultConfig;

const defaultRequest: RunRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function plainData(value: unknown): unknown {
    return structuredClone(value);
}

function expectedPassingFixtureAnnotations(): unknown {
    return {
        ownership: [],
        tags: [ 'fast' ]
    };
}

function expectedPassingFixtureControls(): unknown {
    return {
        capture: null,
        timeoutMilliseconds: null
    };
}

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects live capture for microtest profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveMicrotestLiveCapture() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: defaultRunRequest({
                            capture: 'live',
                            paths: [ passingFixturePath ]
                        })
                    }));
                }, { message: 'Microtest profiles do not support live capture.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects capture controls for microtest profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveMicrotestCaptureControls() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: defaultRunRequest({
                            paths: [ microtestCaptureControlsFixturePath ]
                        })
                    }));
                }, { message: 'Microtest controls do not support capture mode.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() returns frozen run facts for explicit paths',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));

                scope.assert.equal(Object.isFrozen(resolvedRun), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts.cases), true);
                scope.assert.deepEqual(plainData(resolvedRun.facts), {
                    cases: [
                        {
                            fileSet: null,
                            id: {
                                file: passingFixturePath,
                                title: 'passes',
                                params: null,
                                suite: [ 'fixture' ]
                            },
                            annotations: serializeValue(expectedPassingFixtureAnnotations()),
                            controls: serializeValue(expectedPassingFixtureControls())
                        }
                    ],
                    environment: {
                        node: {
                            arch: 'x64',
                            platform: 'linux',
                            version: '26.1.1'
                        },
                        projectRoot: process.cwd(),
                        runtimeStateDir: '.overkill'
                    },
                    execution: {
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        debug: { mode: 'off', selectors: [] },
                        engine: { kind: 'default' },
                        order: 'seeded',
                        processModel: 'supervised-process',
                        profile: 'microtest',
                        resourceUsagePolicy: {
                            budgets: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            },
                            measure: false,
                            samplingIntervalMilliseconds: 100
                        },
                        scheduling: 'concurrent',
                        testFamily: 'microtest',
                        timeoutPolicy: {
                            collectionMilliseconds: 5000,
                            hardMilliseconds: 1000,
                            softMilliseconds: 500
                        },
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        selection: { kind: 'all' },
                        seed: '42',
                        shard: { index: 0, total: 1 }
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() generates a seed when the request does not provide one',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        seed: { value: null }
                    }
                }));

                scope.assert.equal(resolvedRun.facts.reproducibility.seed, '99');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects empty input without profile file discovery',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveEmptyPaths() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            paths: []
                        }
                    }));
                }, {
                    message: 'No run paths were provided and the selected profile has no file discovery policy.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects invalid negative seeds',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveInvalidSeed() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            seed: { value: -1n }
                        }
                    }));
                }, {
                    message: 'Run seed must be a nonnegative bigint.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects unsupported sharding',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveUnsupportedShard() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            shard: { index: 1, total: 2 }
                        }
                    }));
                }, {
                    message: 'Sharding is not implemented yet.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects unknown profiles',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveUnknownProfile() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            profile: 'missing'
                        }
                    }));
                }, {
                    message: 'Unknown run profile: missing'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects resource budget overrides without measurement',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveInvalidResourceUsage() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            measureResourceUsage: false,
                            resourceBudgetOverrides: {
                                activeResourceCount: 1,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            }
                        }
                    }));
                }, {
                    message: 'Resource budget overrides require resource usage measurement.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() executes the resolved plan and reports run facts',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryRealTimeReporter();
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: {
                        ...defaultConfig,
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: {
                                    processModel: 'in-process'
                                }
                            })
                        },
                        reporters: [ reporter ]
                    },
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));
                const runStartEvent = reporter.getRecordedEntries()[0]?.event;

                scope.require.defined(runStartEvent);
                scope.assert.equal(runStartEvent.kind, 'run-start');
                scope.assert.deepEqual(plainData(runStartEvent.kind === 'run-start' ? runStartEvent.facts : null), {
                    cases: [
                        {
                            fileSet: null,
                            id: {
                                file: passingFixturePath,
                                title: 'passes',
                                params: null,
                                suite: [ 'fixture' ]
                            },
                            annotations: serializeValue(expectedPassingFixtureAnnotations()),
                            controls: serializeValue(expectedPassingFixtureControls())
                        }
                    ],
                    environment: {
                        node: {
                            arch: 'x64',
                            platform: 'linux',
                            version: '26.1.1'
                        },
                        projectRoot: process.cwd(),
                        runtimeStateDir: '.overkill'
                    },
                    execution: {
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        debug: { mode: 'off', selectors: [] },
                        engine: { kind: 'default' },
                        order: 'seeded',
                        processModel: 'in-process',
                        profile: 'microtest',
                        resourceUsagePolicy: {
                            budgets: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            },
                            measure: false,
                            samplingIntervalMilliseconds: 100
                        },
                        scheduling: 'concurrent',
                        testFamily: 'microtest',
                        timeoutPolicy: {
                            collectionMilliseconds: 1000,
                            hardMilliseconds: 1000,
                            softMilliseconds: 500
                        },
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        selection: { kind: 'all' },
                        seed: '42',
                        shard: { index: 0, total: 1 }
                    }
                });
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 2,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() executes the supervised process profile in a child process',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: defaultRunConfig({
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                timeouts: { collectionMilliseconds: 5000 }
                            })
                        }
                    }),
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));

                scope.assert.deepEqual(result.runnerErrors, []);
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 2,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() rejects invalid requests before collection',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function runInvalidRequest() {
                    await runOrchestrator.run(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            seed: { value: -1n }
                        }
                    }));
                }, { message: 'Run seed must be a nonnegative bigint.' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'RunResolutionError exposes stable error codes',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const error = new RunResolutionError('Unsupported.', undefined, 'unsupported-request');

                scope.assert.equal(error.name, 'RunResolutionError');
                scope.assert.equal(error.code(), 'unsupported-request');

                return scope.assert.collect();
            }
        }),
        runCollectionErrorReportingTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
