import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { RunResolutionError } from './run-errors.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { orchestrator } from './run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const emptySuiteFixturePath = 'source/integration-tests/run/fixtures/empty-suite.test.ts';
const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

const defaultConfig: RunConfig = defaultRunConfig();
const supervisedCollectionConfig: RunConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});

const defaultRequest: RunRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function plainData(value: unknown): unknown {
    return structuredClone(value);
}

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() returns frozen run facts for explicit paths',
            metadata: {},
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
                            id: {
                                file: passingFixturePath,
                                name: 'passes',
                                params: null,
                                suite: [ 'fixture' ]
                            },
                            metadata: {
                                constructorName: 'Object',
                                entries: [
                                    {
                                        key: { kind: 'string', value: 'file' },
                                        value: { kind: 'string', truncation: null, value: 'passing' }
                                    },
                                    {
                                        key: { kind: 'string', value: 'tag' },
                                        value: { kind: 'string', truncation: null, value: 'fast' }
                                    }
                                ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ],
                    environment: {
                        node: {
                            arch: 'x64',
                            platform: 'linux',
                            version: '26.1.1'
                        },
                        runtimeStateDir: '.overkill'
                    },
                    execution: {
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        debug: { mode: 'off', selectors: [] },
                        engine: { kind: 'default' },
                        order: 'plan',
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
                            collectionMilliseconds: 1000,
                            hardMilliseconds: 1000,
                            softMilliseconds: 500
                        },
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        seed: '42',
                        shard: { index: 0, total: 1 }
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() generates a seed when the request does not provide one',
            metadata: {},
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
            name: 'orchestrator.resolve() rejects empty explicit input',
            metadata: {},
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
                    message: 'No explicit run paths were provided.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects invalid negative seeds',
            metadata: {},
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
            name: 'orchestrator.resolve() rejects unsupported sharding',
            metadata: {},
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
            name: 'orchestrator.resolve() rejects unknown profiles',
            metadata: {},
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
            name: 'orchestrator.resolve() rejects resource budget overrides without measurement',
            metadata: {},
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
            name: 'orchestrator.run() executes the resolved plan and reports run facts',
            metadata: {},
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
                            id: {
                                file: passingFixturePath,
                                name: 'passes',
                                params: null,
                                suite: [ 'fixture' ]
                            },
                            metadata: {
                                constructorName: 'Object',
                                entries: [
                                    {
                                        key: { kind: 'string', value: 'file' },
                                        value: { kind: 'string', truncation: null, value: 'passing' }
                                    },
                                    {
                                        key: { kind: 'string', value: 'tag' },
                                        value: { kind: 'string', truncation: null, value: 'fast' }
                                    }
                                ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ],
                    environment: {
                        node: {
                            arch: 'x64',
                            platform: 'linux',
                            version: '26.1.1'
                        },
                        runtimeStateDir: '.overkill'
                    },
                    execution: {
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        debug: { mode: 'off', selectors: [] },
                        engine: { kind: 'default' },
                        order: 'plan',
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
            name: 'orchestrator.run() executes the supervised process profile in a child process',
            metadata: {},
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
            name: 'orchestrator.run() returns collection failures as runner errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const importFailureResult = await runOrchestrator.run(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ throwsOnImportFixturePath ]
                    }
                }));
                const collectionFailureResult = await runOrchestrator.run(createRunCommand({
                    config: supervisedCollectionConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: {
                        ...defaultRequest,
                        paths: [ emptySuiteFixturePath ]
                    }
                }));

                scope.assert.deepEqual(importFailureResult.summary, {
                    crashed: 0,
                    defined: 0,
                    discovered: 0,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 0,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(
                    importFailureResult.runnerErrors.map(function toRunnerError(error) {
                        return {
                            attributedTo: error.attributedTo,
                            message: error.message,
                            subtype: error.subtype
                        };
                    }),
                    [
                        {
                            attributedTo: null,
                            message: `Failed to load test module: ${throwsOnImportFixturePath}`,
                            subtype: 'loader'
                        }
                    ]
                );
                scope.assert.deepEqual(
                    collectionFailureResult.runnerErrors.map(function toMessage(error) {
                        return error.message;
                    }),
                    [ 'Failed to collect tests from explicit run inputs.' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() rejects invalid requests before collection',
            metadata: {},
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
            name: 'orchestrator.run() rejects instance engines for supervised execution',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function runWithCustomSupervisedEngine() {
                    await runOrchestrator.run(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { engine: defaultRunEngine, kind: 'instance' },
                        request: defaultRequest
                    }));
                }, {
                    message:
                        'Instance engines are not supported with supervised-process execution. Use a module engine.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'RunResolutionError exposes stable error codes',
            metadata: {},
            async body(scope: OverkillScope) {
                const error = new RunResolutionError('Unsupported.', undefined, 'unsupported-request');

                scope.assert.equal(error.name, 'RunResolutionError');
                scope.assert.equal(error.code(), 'unsupported-request');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
