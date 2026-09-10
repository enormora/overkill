import { createDeterministicWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createInMemoryFinalResultReporter } from '../reporters/in-memory-reporter.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import {
    createExecutionSupervision,
    recordResourceUsageSample
} from './execution-supervision.ts';
import type { ResourceUsageSnapshot, RunResourceUsageTracker } from './run-result.ts';

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

type BreachingResourceUsageTracker = {
    readonly emitSamples: () => void;
    readonly tracker: RunResourceUsageTracker;
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

function createBreachingResourceUsageTracker(): BreachingResourceUsageTracker {
    let recordSample: ((resourceSample: ResourceUsageSnapshot) => void) | null = null;

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
                recordSample = onSample ?? null;
            }
        }
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/execution-resource-usage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() includes resource usage in the returned result and final reporter result',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() records sampled resource exhaustion against the active case',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const engine = createEngine();
                const resourceUsageTracker = createBreachingResourceUsageTracker();
                const testPlan = engine.createTestPlan(
                    engine.createRoot({
                        children: [
                            engine.createTestCase({
                                definitionLocations: [ { kind: 'unknown' as const } ],
                                body(testScope) {
                                    resourceUsageTracker.emitSamples();
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
                    execution: { mode: 'concurrent-in-process' },
                    reporters: [],
                    resourceBudgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: 1,
                        residentSetGrowthBytesPerSecond: null
                    },
                    resourceUsageTracker: resourceUsageTracker.tracker,
                    runFacts: {},
                    startedAt: '2026-07-15T00:00:00.000Z'
                });

                scope.assert.equal(result.runnerErrors[0]?.subtype, 'resource-exhaustion');
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() applies valid timeout controls before the default timeout',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() rejects timeout controls beyond the soft timeout',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'recordResourceUsageSample() reports post-test resource diagnostics',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'recordResourceUsageSample() ignores omitted budgets',
            annotations: {},
            controls: {},
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
