import { runIfMain } from '#test-runner';
import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type RunResult,
    type ProcessUsageSnapshot,
    type RunProcessUsageTracker,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    createInMemoryFinalResultReporter,
    createInMemoryRealTimeReporter,
    type InMemoryRealTimeReporter
} from '../reporters/in-memory-reporter.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import { executeCasesAndMeasureProcessUsage } from './execution-process-tracked-cases.ts';
import {
    createExecutionSupervision,
    recordProcessUsageSample,
    type ExecutionSupervisionDependencies
} from './execution-supervision.ts';
import { createDisabledExecutionGlobalErrorObserver } from './execution-global-error-observer.ts';
import type { ReporterDelivery } from './reporter-dispatcher.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;

const sample = {
    activeResourceCount: 1,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMicroseconds: 2,
    javaScriptEngineHeapBytes: 30,
    residentSetBytes: 40
};

const previousSample = {
    ...sample,
    activeResourceCount: 0,
    capturedAtMicroseconds: 1,
    javaScriptEngineHeapBytes: 20,
    residentSetBytes: 30
};

type BreachingProcessUsageTracker = {
    readonly emitSamples: () => void;
    readonly tracker: RunProcessUsageTracker;
};

type SampledProcessExhaustionFixture = {
    readonly reporter: InMemoryRealTimeReporter;
    readonly result: RunResult;
};

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

function recordedRunnerErrorMessages(reporter: InMemoryRealTimeReporter): readonly string[] {
    return reporter.getRecordedEntries().flatMap(function toMessage(entry) {
        return entry.event?.kind === 'runner-error'
            ? [ entry.event.error.message ]
            : [];
    });
}

function createSilentReporterDelivery(): ReporterDelivery {
    return {
        async disposeReporters() {
            return [];
        },
        async reportEvent() {
            return [];
        },
        async reportResult() {
            return [];
        }
    };
}

function executionDependencies(
    wallClock: DeterministicClock
): ExecutionSupervisionDependencies {
    return {
        benchmarkEnvironment: null,
        globalErrorObserver: createDisabledExecutionGlobalErrorObserver(),
        wallClock
    };
}

function createFinishedProcessUsageTracker(): RunProcessUsageTracker {
    return {
        finish() {
            return {
                activeResourceTypes: [ 'Timeout' ],
                end: {
                    activeResourceCount: 1,
                    activeResourceTypes: [ 'Timeout' ],
                    capturedAtMicroseconds: 2,
                    javaScriptEngineHeapBytes: 30,
                    residentSetBytes: 40
                },
                peakActiveResourceCount: 1,
                peakJavaScriptEngineHeapBytes: 30,
                peakResidentSetBytes: 40,
                peakResidentSetGrowthBytesPerSecond: 500,
                sampleCount: 2,
                start: {
                    activeResourceCount: 0,
                    activeResourceTypes: [],
                    capturedAtMicroseconds: 1,
                    javaScriptEngineHeapBytes: 20,
                    residentSetBytes: 30
                }
            };
        },
        start() {
            return undefined;
        }
    };
}

function createBreachingProcessUsageTracker(): BreachingProcessUsageTracker {
    let recordSample: ((processUsageSample: ProcessUsageSnapshot) => void) | null = null;

    return {
        emitSamples() {
            recordSample?.(sample);
            recordSample?.(sample);
        },
        tracker: {
            finish() {
                return {
                    activeResourceTypes: [ 'Timeout' ],
                    end: {
                        activeResourceCount: 1,
                        activeResourceTypes: [ 'Timeout' ],
                        capturedAtMicroseconds: 2,
                        javaScriptEngineHeapBytes: 30,
                        residentSetBytes: 40
                    },
                    peakActiveResourceCount: 1,
                    peakJavaScriptEngineHeapBytes: 30,
                    peakResidentSetBytes: 40,
                    peakResidentSetGrowthBytesPerSecond: 0,
                    sampleCount: 1,
                    start: {
                        activeResourceCount: 1,
                        activeResourceTypes: [ 'Timeout' ],
                        capturedAtMicroseconds: 2,
                        javaScriptEngineHeapBytes: 30,
                        residentSetBytes: 40
                    }
                };
            },
            start(onSample) {
                recordSample = onSample ?? null;
            }
        }
    };
}

async function executeSampledProcessExhaustion(): Promise<SampledProcessExhaustionFixture> {
    const engine = createEngine();
    const reporter = createInMemoryRealTimeReporter();
    const processUsageTracker = createBreachingProcessUsageTracker();
    const testPlan = engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    definitionLocations: [ { kind: 'unknown' as const } ],
                    body(testScope) {
                        processUsageTracker.emitSamples();
                        testScope.assert.true(true);
                        return testScope.assert.collect();
                    },
                    annotations: {},
                    controls: {},
                    title: 'waits'
                })
            ],
            annotations: {},
            controls: {},
            title: 'root'
        })
    );
    const result = await engine.execute(testPlan, {
        debug: { mode: 'off' },
        retryPolicy: null,
        execution: { maxConcurrency: 'unlimited', mode: 'concurrent-in-process' },
        reporters: [ reporter ],
        processBudgets: {
            activeResourceCount: null,
            javaScriptEngineHeapBytes: null,
            residentSetBytes: 1,
            residentSetGrowthBytesPerSecond: null
        },
        processUsageTracker: processUsageTracker.tracker,
        runFacts: {},
        startedAt: '2026-07-15T00:00:00.000Z'
    });

    return { reporter, result };
}

function assertNativeExhaustionArtifacts(scope: OverkillScope, fixture: SampledProcessExhaustionFixture): void {
    const artifact = fixture.result.artifacts[0];
    scope.require.defined(artifact);
    scope.assert.partialDeepEqual(artifact, {
        id: { subtype: 'process-exhaustion', scope: { kind: 'case' } },
        source: 'native',
        payload: { kind: 'process-exhaustion', metric: 'residentSetBytes', budget: 1 }
    });
    const completedEvent = fixture
        .reporter
        .getRecordedEntries()
        .flatMap(function recordedEvent(entry) {
            return entry.event === null ? [] : [ entry.event ];
        })
        .find(function caseFinished(event) {
            return event.kind === 'test-end';
        });
    scope.require.defined(completedEvent);
    scope.assert.deepEqual(completedEvent.artifacts, fixture.result.artifacts);
}

export const testNode = createOverkillSuite({
    ...metadata,

    title: 'source/engine/execution-process-usage.test.ts',

    children: [
        createOverkillTestCase({
            ...metadata,

            title: 'execute() includes process usage in the returned result and final reporter result',

            async body(scope: OverkillScope) {
                const engine = createEngine();
                const reporter = createInMemoryFinalResultReporter();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: {},
                                title: 'passes'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    debug: { mode: 'off' },
                    retryPolicy: null,
                    execution: { maxConcurrency: 'unlimited', mode: 'concurrent-in-process' },
                    reporters: [ reporter ],
                    processUsageTracker: createFinishedProcessUsageTracker(),
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                const reportedResult = reporter.getRecordedEntries()[0]?.result ?? null;

                scope.assert.deepEqual(plainDataShape(result.processUsage), {
                    activeResourceTypes: [ 'Timeout' ],
                    end: {
                        activeResourceCount: 1,
                        activeResourceTypes: [ 'Timeout' ],
                        capturedAtMicroseconds: 2,
                        javaScriptEngineHeapBytes: 30,
                        residentSetBytes: 40
                    },
                    peakActiveResourceCount: 1,
                    peakJavaScriptEngineHeapBytes: 30,
                    peakResidentSetBytes: 40,
                    peakResidentSetGrowthBytesPerSecond: 500,
                    sampleCount: 2,
                    start: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMicroseconds: 1,
                        javaScriptEngineHeapBytes: 20,
                        residentSetBytes: 30
                    }
                });
                scope.assert.deepEqual(
                    plainDataShape(reportedResult?.processUsage ?? null),
                    plainDataShape(result.processUsage)
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'execute() records sampled process exhaustion against the active case',

            async body(scope: OverkillScope) {
                const { reporter, result } = await executeSampledProcessExhaustion();
                assertNativeExhaustionArtifacts(scope, { reporter, result });

                scope.assert.equal(result.runnerErrors[0]?.subtype, 'process-exhaustion');
                scope.assert.deepEqual(recordedRunnerErrorMessages(reporter), [
                    result.runnerErrors[0]?.message
                ]);
                scope.assert.deepEqual(plainDataShape(result.runnerErrors[0]?.attributedTo ?? null), {
                    file: null,
                    title: 'waits',
                    params: null,
                    suite: []
                });
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 1,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 1,
                    processExhausted: 1,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(
                    result.perTest.map(function toVerdict(testResult) {
                        return testResult.verdict;
                    }),
                    [ 'process-exhausted' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'execute() applies valid timeout controls before the default timeout',

            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: { timeoutMilliseconds: 5 },
                                title: 'uses control timeout'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    debug: { mode: 'off' },
                    retryPolicy: null,
                    execution: { maxConcurrency: 'unlimited', mode: 'concurrent-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z',
                    timeoutPolicy: {
                        hardTimeoutMilliseconds: 50,
                        timeoutMilliseconds: 40
                    }
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'execute() rejects timeout controls beyond the soft timeout',

            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                annotations: {},
                                controls: { timeoutMilliseconds: 45 },
                                title: 'invalid timeout controls'
                            })
                        ],
                        annotations: {},
                        controls: {},
                        title: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    debug: { mode: 'off' },
                    retryPolicy: null,
                    execution: { maxConcurrency: 'unlimited', mode: 'concurrent-in-process' },
                    reporters: [],
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z',
                    timeoutPolicy: {
                        hardTimeoutMilliseconds: 50,
                        timeoutMilliseconds: 40
                    }
                });
                const outcome = result.perTest[0]?.outcome;

                scope.assert.equal(outcome?.kind, 'fail');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'recordProcessUsageSample() reports post-test process usage diagnostics',

            body(scope: OverkillScope) {
                const supervision = createExecutionSupervision();
                const breached = recordProcessUsageSample({
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: 1,
                        residentSetGrowthBytesPerSecond: null
                    },
                    dependencies: executionDependencies(createDeterministicClock({ initialUnixEpochMicroseconds: 0n })),
                    previousSample,
                    sample,
                    supervision
                });
                const error = supervision.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(breached, true);
                scope.assert.equal(error.subtype, 'process-exhaustion');
                scope.assert.equal(error.attributedTo, null);
                scope.assert.deepEqual(plainDataShape(error.cause), {
                    activeAttempts: [],
                    activeCases: [],
                    activeWork: [],
                    budget: 1,
                    enforcement: 'post-test-diagnostic',
                    metric: 'residentSetBytes',
                    observed: 40,
                    sample
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'recordProcessUsageSample() ignores omitted budgets',

            body(scope: OverkillScope) {
                const supervision = createExecutionSupervision();
                const dependencies = executionDependencies(
                    createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
                );
                const nullBudgetBreach = recordProcessUsageSample({
                    budgets: null,
                    dependencies,
                    previousSample: null,
                    sample,
                    supervision
                });
                const undefinedBudgetBreach = recordProcessUsageSample({
                    budgets: undefined,
                    dependencies,
                    previousSample: null,
                    sample,
                    supervision
                });

                scope.assert.equal(nullBudgetBreach, false);
                scope.assert.equal(undefinedBudgetBreach, false);
                scope.assert.equal(supervision.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            ...metadata,

            title: 'executeCasesAndMeasureProcessUsage() stops tracking after execution throws',

            async body(scope: OverkillScope) {
                let finishCount = 0;

                await scope.assert.rejects(async function executeThrowingCases() {
                    await executeCasesAndMeasureProcessUsage({
                        context: {
                            dependencies: executionDependencies(
                                createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
                            ),
                            reporterDelivery: createSilentReporterDelivery()
                        },
                        options: {
                            processBudgets: null,
                            processUsageTracker: {
                                finish() {
                                    finishCount += 1;

                                    return createFinishedProcessUsageTracker().finish();
                                },
                                start() {
                                    return undefined;
                                }
                            }
                        },
                        supervision: createExecutionSupervision()
                    }, async function throwDuringCaseExecution() {
                        throw new Error('case execution failed');
                    });
                }, { message: 'case execution failed' });
                scope.assert.equal(finishCount, 1);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
