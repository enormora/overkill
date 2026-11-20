import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';

import {
    passingFixturePath,
    expectedRunEnvironment,
    expectedPassingFixtureCaseFact,
    expectedPassingFixtureLiveCaseFact
} from '../test-support/run-facts-expectations.ts';

import { defaultFailureArtifactPolicy } from '../packages/engine/engine.entry-point.ts';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createUnitRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultMicrotestProfile, defaultRunConfig, defaultRunRequest } from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';

import { RunResolutionError } from './run-errors.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

type RunCommandParts = {
    readonly config: NormalizedConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const emptyTestData = { annotations: {}, controls: {} };

const microtestCaptureControlsFixturePath =
    'source/integration-tests/integration/fixtures/microtest-capture-controls.test.ts';

const defaultConfig: NormalizedConfig = defaultRunConfig({
    profiles: {
        microtest: defaultMicrotestProfile({
            timeouts: { collectionMilliseconds: 5000 }
        })
    }
});

const defaultRequest: RunRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

export const testNode: TestNode = suite({
    title: 'Test run orchestration',
    ...emptyTestData,
    children: [
        test({
            title: 'orchestrator.resolve() rejects live capture for microtest profiles',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

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
        test({
            title: 'orchestrator.resolve() rejects worker counts for non-worker-pool profiles',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

                await scope.assert.rejects(async function resolveMicrotestWorkerCount() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: defaultRunRequest({
                            paths: [ passingFixturePath ],
                            workers: 2
                        })
                    }));
                }, { message: 'Worker count can only be requested for worker-pool profiles.' });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'orchestrator.resolve() rejects capture controls for microtest profiles',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

                await scope.assert.rejects(async function resolveMicrotestCaptureControls() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: defaultRunRequest({
                            paths: [ microtestCaptureControlsFixturePath ]
                        })
                    }));
                }, { message: 'Run profile "microtest" cannot run test cases with authored capture controls.' });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'orchestrator.resolve() returns frozen run facts for explicit paths',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
                    cwd: process.cwd(),
                    engine: { kind: 'default' },
                    request: defaultRequest
                }));

                scope.assert.equal(Object.isFrozen(resolvedRun), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts.cases), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts.reproducibility.selectedIdentities), true);
                const expectedCase = expectedPassingFixtureCaseFact();
                scope.assert.deepEqual(structuredClone<unknown>(resolvedRun.facts), {
                    family: { id: 'microtest', version: '1', settings: null, preparation: null, collection: null },
                    adapter: null,
                    implementations: null,
                    cases: [
                        expectedCase
                    ],
                    benchmarkHost: null,
                    benchmarkCalibration: null,
                    benchmarkNormalization: null,
                    benchmarkPlacement: null,
                    coveragePolicy: null,
                    durationHistory: null,
                    environment: expectedRunEnvironment(),
                    execution: {
                        debuggedCases: [],
                        failureArtifacts: defaultFailureArtifactPolicy,
                        benchmarkGarbageCollection: null,
                        propertyPolicy: null,
                        attachments: null,
                        retries: null,
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        coverage: false,
                        debug: { mode: 'off', selectors: [] },
                        engine: { kind: 'default' },
                        maxConcurrency: 5,
                        order: 'seeded',
                        placementPlan: null,
                        processModel: 'supervised-process',
                        profile: 'microtest',
                        processUsagePolicy: {
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
                        runRecords: { persist: true, reasons: [ 'history' ] },
                        timingCollection: 'summary',
                        timeoutPolicy: {
                            collectionMilliseconds: 5000,
                            hardMilliseconds: 1000,
                            softMilliseconds: 500
                        },
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        selectedIdentities: [ expectedCase.workId ],
                        selection: { kind: 'all' },
                        seed: '42',
                        shard: { index: 1, total: 1 },
                        shardHashAlgorithm: 'xxh3-64-canonical-json-v1'
                    }
                });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'orchestrator.resolve() generates a seed when the request does not provide one',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
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
        test({
            title: 'orchestrator.resolve() rejects empty input without profile file discovery',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

                await scope.assert.rejects(async function resolveEmptyPaths() {
                    await runOrchestrator.resolve(createRunCommand({
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
        test({
            title: 'orchestrator.resolve() rejects invalid negative seeds',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidSeed() {
                    await runOrchestrator.resolve(createRunCommand({
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
        test({
            title: 'orchestrator.resolve() rejects unknown profiles',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

                await scope.assert.rejects(async function resolveUnknownProfile() {
                    await runOrchestrator.resolve(createRunCommand({
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
        test({
            title: 'orchestrator.resolve() rejects process budget overrides without measurement',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidProcessUsage() {
                    await runOrchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: { kind: 'default' },
                        request: {
                            ...defaultRequest,
                            measureProcessUsage: false,
                            processBudgetOverrides: {
                                activeResourceCount: 1,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            }
                        }
                    }));
                }, {
                    message: 'Process budget overrides require process usage measurement.'
                });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'orchestrator.run() executes the resolved plan and reports run facts',
            ...emptyTestData,
            async body(
                scope: {
                    readonly assert: Pick<TestScope['assert'], 'equal' | 'deepEqual' | 'collect'>;
                    readonly require: Pick<TestScope['require'], 'defined'>;
                }
            ) {
                const reporter = createInMemoryRealTimeReporter();
                const runOrchestrator = createUnitRunOrchestrator();
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
                const expectedCase = expectedPassingFixtureLiveCaseFact();
                scope.assert.deepEqual(
                    structuredClone<unknown>(runStartEvent.kind === 'run-start' ? runStartEvent.facts : null),
                    {
                        family: { id: 'microtest', version: '1', settings: null, preparation: null, collection: null },
                        adapter: null,
                        implementations: null,
                        cases: [
                            expectedCase
                        ],
                        benchmarkHost: null,
                        benchmarkCalibration: null,
                        benchmarkNormalization: null,
                        benchmarkPlacement: null,
                        coveragePolicy: null,
                        durationHistory: null,
                        environment: expectedRunEnvironment(),
                        execution: {
                            debuggedCases: [],
                            failureArtifacts: defaultFailureArtifactPolicy,
                            benchmarkGarbageCollection: null,
                            propertyPolicy: null,
                            attachments: null,
                            retries: null,
                            baselineUpdateMode: 'none',
                            capture: 'buffered',
                            coverage: false,
                            debug: { mode: 'off', selectors: [] },
                            engine: { kind: 'default' },
                            maxConcurrency: 5,
                            order: 'seeded',
                            placementPlan: null,
                            processModel: 'in-process',
                            profile: 'microtest',
                            processUsagePolicy: {
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
                            runRecords: { persist: true, reasons: [ 'history' ] },
                            timingCollection: 'summary',
                            timeoutPolicy: {
                                collectionMilliseconds: 1000,
                                hardMilliseconds: 1000,
                                softMilliseconds: 500
                            },
                            verbose: false
                        },
                        loader: { sourceMaps: false, stripMode: 'strip-only' },
                        reproducibility: {
                            selectedIdentities: [ expectedCase.workId ],
                            selection: { kind: 'all' },
                            seed: '42',
                            shard: { index: 1, total: 1 },
                            shardHashAlgorithm: 'xxh3-64-canonical-json-v1'
                        }
                    }
                );
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 2,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    processExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'orchestrator.run() executes the supervised process profile in a child process',
            ...emptyTestData,
            async body(scope) {
                const runOrchestrator = createUnitRunOrchestrator();
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
                    processExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        test({
            title: 'RunResolutionError exposes stable error codes',
            ...emptyTestData,
            async body(scope) {
                const error = new RunResolutionError('Unsupported.', undefined, 'unsupported-request');

                scope.assert.equal(error.name, 'RunResolutionError');
                scope.assert.equal(error.code(), 'unsupported-request');

                return scope.assert.collect();
            }
        })
    ]
});
