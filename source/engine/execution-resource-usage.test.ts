import { setTimeout as scheduleTimeout } from 'node:timers';
import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createInMemoryFinalResultReporter } from '../reporters/in-memory-reporter.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import {
    createExecutionSupervision,
    recordResourceUsageSample
} from './execution-supervision.ts';
import type { RunResourceUsageTracker } from './run-result.ts';

const sample = {
    activeResourceCount: 1,
    activeResourceTypes: [ 'Timeout' ],
    capturedAtMilliseconds: 2,
    javaScriptEngineHeapBytes: 30,
    residentSetBytes: 40
};

const previousSample = {
    ...sample,
    activeResourceCount: 0,
    capturedAtMilliseconds: 1,
    javaScriptEngineHeapBytes: 20,
    residentSetBytes: 30
};

function plainDataShape(value: unknown): unknown {
    const { stringify } = JSON;
    const { parse } = JSON;

    return parse(stringify(value));
}

function createFinishedResourceUsageTracker(): RunResourceUsageTracker {
    return {
        finish() {
            return {
                activeResourceTypes: [ 'Timeout' ],
                end: {
                    activeResourceCount: 1,
                    activeResourceTypes: [ 'Timeout' ],
                    capturedAtMilliseconds: 2,
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
                    capturedAtMilliseconds: 1,
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

function createBreachingResourceUsageTracker(): RunResourceUsageTracker {
    return {
        finish() {
            return {
                activeResourceTypes: [ 'Timeout' ],
                end: {
                    activeResourceCount: 1,
                    activeResourceTypes: [ 'Timeout' ],
                    capturedAtMilliseconds: 2,
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
                    capturedAtMilliseconds: 2,
                    javaScriptEngineHeapBytes: 30,
                    residentSetBytes: 40
                }
            };
        },
        start(onSample) {
            function sendSample(): void {
                onSample?.(sample);
            }

            scheduleTimeout(sendSample, 0);
            scheduleTimeout(sendSample, 0);
        }
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/execution-resource-usage.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'execute() includes resource usage in the returned result and final reporter result',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const reporter = createInMemoryFinalResultReporter();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                metadata: {},
                                name: 'passes'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'concurrent-in-process' },
                    reporters: [ reporter ],
                    resourceUsageTracker: createFinishedResourceUsageTracker(),
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                const reportedResult = reporter.getRecordedEntries()[0]?.result ?? null;

                scope.assert.deepEqual(plainDataShape(result.resourceUsage), {
                    activeResourceTypes: [ 'Timeout' ],
                    end: {
                        activeResourceCount: 1,
                        activeResourceTypes: [ 'Timeout' ],
                        capturedAtMilliseconds: 2,
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
                        capturedAtMilliseconds: 1,
                        javaScriptEngineHeapBytes: 20,
                        residentSetBytes: 30
                    }
                });
                scope.assert.deepEqual(
                    plainDataShape(reportedResult?.resourceUsage ?? null),
                    plainDataShape(result.resourceUsage)
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() records sampled resource exhaustion against the active case',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                async body(testScope) {
                                    await new Promise(function wait(resolve) {
                                        scheduleTimeout(resolve, 10);
                                    });
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                metadata: {},
                                name: 'waits'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'concurrent-in-process' },
                    reporters: [],
                    resourceBudgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: 1,
                        residentSetGrowthBytesPerSecond: null
                    },
                    resourceUsageTracker: createBreachingResourceUsageTracker(),
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'resource-exhaustion');
                scope.assert.deepEqual(plainDataShape(error.attributedTo), {
                    file: null,
                    name: 'waits',
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
                    resourceExhausted: 1,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.deepEqual(
                    result.perTest.map(function toVerdict(testResult) {
                        return testResult.verdict;
                    }),
                    [ 'resource-exhausted' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() applies valid timeout metadata before the default timeout',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                metadata: { timeoutMilliseconds: 5 },
                                name: 'uses metadata timeout'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'concurrent-in-process' },
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
            name: 'execute() rejects timeout metadata beyond the hard timeout',
            metadata: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                body(testScope) {
                                    testScope.assert.true(true);
                                    return testScope.assert.collect();
                                },
                                metadata: { timeoutMilliseconds: 100 },
                                name: 'invalid timeout metadata'
                            })
                        ],
                        metadata: {},
                        name: 'root'
                    })
                );
                const result = await engine.execute(testPlan, {
                    execution: { mode: 'concurrent-in-process' },
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
            name: 'recordResourceUsageSample() reports post-test resource diagnostics',
            metadata: {},
            body(scope: OverkillScope) {
                const supervision = createExecutionSupervision();
                const breached = recordResourceUsageSample({
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: 1,
                        residentSetGrowthBytesPerSecond: null
                    },
                    dependencies: { wallClock: createDeterministicWallClock() },
                    previousSample,
                    sample,
                    supervision
                });
                const error = supervision.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(breached, true);
                scope.assert.equal(error.subtype, 'resource-exhaustion');
                scope.assert.equal(error.attributedTo, null);
                scope.assert.deepEqual(plainDataShape(error.cause), {
                    activeCases: [],
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
            name: 'recordResourceUsageSample() ignores omitted budgets',
            metadata: {},
            body(scope: OverkillScope) {
                const supervision = createExecutionSupervision();
                const dependencies = { wallClock: createDeterministicWallClock() };
                const nullBudgetBreach = recordResourceUsageSample({
                    budgets: null,
                    dependencies,
                    previousSample: null,
                    sample,
                    supervision
                });
                const undefinedBudgetBreach = recordResourceUsageSample({
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
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
