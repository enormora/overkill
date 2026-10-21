import {
    createRoot,
    createTestPlan,
    execute,
    type TestCase,
    type RunResult
} from '../packages/engine/engine.entry-point.ts';
import {
    benchmark,
    asyncMeasurementStrategy,
    defaultSamplingPolicy,
    rawMeasurement,
    timelineMeasurement,
    wallClockMeasurement,
    workload,
    type BenchmarkMeasureContext
} from '../packages/bench/bench.entry-point.ts';
import { defineResource, withResource } from '../packages/test/resources.entry-point.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { testNode as benchmarkEvidenceTestNode } from './benchmark-evidence.test.ts';
import { testNode as measurementRuntimePolicyTestNode } from './measurement-runtime-policy.test.ts';
import { testNode as benchmarkTimeoutEvidenceTestNode } from './benchmark-timeout-evidence.test.ts';
import { testNode as garbageCollectionTestNode } from './benchmark-garbage-collection.test.ts';
import { testNode as benchmarkLifecycleTestNode } from './benchmark-lifecycle.test.ts';
import { testNode as benchmarkCooldownTestNode } from './benchmark-runtime-cooldown.test.ts';

async function executeBenchmark(node: TestCase): Promise<RunResult> {
    return await execute(
        createTestPlan(createRoot({ annotations: {}, controls: {}, title: 'root', children: [ node ] }))
    );
}

function assertFirstWorkload(scope: TestScope, result: RunResult): void {
    const first = result.perTest[0];
    if (first?.benchmark === undefined || first.benchmark === null) {
        throw new Error('Missing benchmark summary.');
    }
    scope.assert.equal(first.benchmark.samples, 128);
    scope.assert.equal(first.benchmark.metrics.size?.median, 1);
    scope.assert.equal(first.attempts[0].benchmark?.status, 'complete');
}

function assertBoundedTimeline(scope: TestScope, result: RunResult): void {
    const measured = result.perTest[0]?.benchmark;
    scope.require.defined(measured);
    const { timeline } = measured;
    scope.require.defined(timeline);
    scope.assert.equal(measured.samples, 2);
    scope.assert.equal(timeline.events, 3);
    scope.assert.equal(timeline.status, 'omitted');
    scope.assert.true(timeline.omitted > 0);
}

export const testNode = suite('benchmark authoring and sampling', [
    test('bounds lifecycle traces without changing warmup, cleanup, or budgets', async function (scope) {
        let cleanups = 0;
        const result = await executeBenchmark(benchmark('bounded timeline', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: rawMeasurement(timelineMeasurement(wallClockMeasurement(), { maximumEvents: 3 })),
            measure({ sample }) {
                sample.cleanup(function reset() {
                    cleanups += 1;
                    sample.timeline.mark('reset');
                });
                sample.timeline.mark('prepared');
                const measured = sample.measure(function operation() {
                    return 42;
                });
                return { value: measured.value };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { minimum: 42, maximum: 42, statistic: { kind: 'observed-maximum' } } } }
        }, {
            annotations: {},
            controls: {},
            lifecycle: { garbageCollection: 'off', warmupSamples: 1, cooldown: { mode: 'off' } },
            sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
        }));
        scope.assert.equal(result.summary.passed, 1);
        assertBoundedTimeline(scope, result);
        scope.assert.equal(cleanups, 3);
        return scope.assert.collect();
    }),
    test('samples asynchronous strategies with explicit diagnostic metrics', async function (scope) {
        const result = await executeBenchmark(benchmark('async', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: asyncMeasurementStrategy([]),
            async measure({ sample }) {
                const measured = await sample.measure(async function () {
                    return await Promise.resolve(3);
                });
                return { value: measured.value, diagnostic: 0 };
            },
            diagnosticMetrics: [ 'diagnostic' ],
            budgets: { one: { value: { maximum: 4, statistic: { kind: 'observed-maximum' } } } }
        }, {
            annotations: {},
            controls: {},
            sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
        }));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.perTest[0]?.benchmark?.samples, 2);
        scope.assert.equal(result.perTest[0]?.benchmark?.metrics.diagnostic?.median, 0);
        return scope.assert.collect();
    }),
    benchmarkEvidenceTestNode,
    measurementRuntimePolicyTestNode,
    benchmarkTimeoutEvidenceTestNode,
    benchmarkLifecycleTestNode,
    garbageCollectionTestNode,
    benchmarkCooldownTestNode,
    test('expands workloads and stops at the first precise checkpoint', async function (scope) {
        let calls = 0;
        const result = await executeBenchmark(benchmark('workloads', {
            kind: 'runtime',
            workloads: [ workload('small', { size: 1 }), workload('large', { size: 2 }) ],
            measurement: wallClockMeasurement(),
            measure(context) {
                calls += 1;
                const measured = context.sample.measure(function () {
                    return context.workload.parameters.size;
                });
                return { size: measured.value };
            },
            diagnosticMetrics: [],
            budgets: { small: { size: { maximum: 2 } }, large: { size: { maximum: 3 } } }
        }));
        scope.assert.equal(calls, 320);
        scope.assert.equal(result.summary.passed, 2);
        scope.assert.deepEqual(
            result.perTest.map(function (entry) {
                return entry.workId.workload?.name;
            }),
            [ 'small', 'large' ]
        );
        assertFirstWorkload(scope, result);
        return scope.assert.collect();
    }),
    test('acquires one resource envelope around repeated samples', async function (scope) {
        let acquired = 0;
        let disposed = 0;
        const resource = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            acquire() {
                acquired += 1;
                return { bytes: 3 };
            },
            dispose() {
                disposed += 1;
            }
        });
        const measure = withResource<
            typeof resource,
            BenchmarkMeasureContext<{ readonly size: number; }>,
            { readonly bytes: number; }
        >(resource, function (context) {
            const measured = context.sample.measure(function () {
                return context.resources.fixture.bytes;
            });
            return { bytes: measured.value };
        });
        const result = await executeBenchmark(benchmark('resource', {
            kind: 'memory',
            workloads: [ workload('one', { size: 1 }) ],
            measurement: wallClockMeasurement(),
            measure,
            diagnosticMetrics: [],
            budgets: { one: { bytes: { maximum: 4 } } }
        }));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(acquired, 1);
        scope.assert.equal(disposed, 1);
        return scope.assert.collect();
    }),
    test('reports missing metrics as budget failures', async function (scope) {
        const result = await executeBenchmark(benchmark('missing', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    return 1;
                });
                return {};
            },
            diagnosticMetrics: [],
            budgets: { one: { missing: { maximum: 1 } } }
        }));
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.perTest[0]?.benchmark?.budgets[0]?.decision, 'unavailable');
        scope.assert.equal(result.runnerErrors.length, 0);
        return scope.assert.collect();
    }),
    test('keeps unresolved intervals inconclusive with a measurement error', async function (scope) {
        let value = 0;
        const result = await executeBenchmark(benchmark('overlap', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    return 1;
                });
                value += 1;
                return { value: value % 2 };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 0.5 } } }
        }, { annotations: {}, controls: {}, sampling: { ...defaultSamplingPolicy, maximumSamples: 128 } }));
        scope.assert.equal(result.status, 'failed');
        scope.assert.equal(result.summary.inconclusive, 1);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        scope.assert.equal(result.perTest[0]?.benchmark?.status, 'incomplete');
        return scope.assert.collect();
    }),
    test('rejects an undeclared metric and missing or repeated regions', async function (scope) {
        const createInvalid = function (mode: string): TestCase {
            return benchmark(mode, {
                kind: 'runtime',
                workloads: [ workload('one', {}) ],
                measurement: wallClockMeasurement(),
                measure({ sample }) {
                    if (mode !== 'missing-region') {
                        sample.measure(function () {
                            return 1;
                        });
                    }
                    if (mode === 'repeated-region') {
                        sample.measure(function () {
                            return 2;
                        });
                    }
                    return { value: 1, ...mode === 'undeclared' ? { extra: 2 } : {} };
                },
                diagnosticMetrics: [],
                budgets: { one: { value: { maximum: 2 } } }
            });
        };
        for (const mode of [ 'undeclared', 'missing-region', 'repeated-region' ]) {
            const result = await executeBenchmark(createInvalid(mode));
            scope.assert.equal(result.summary.inconclusive, 1);
            scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        }

        return scope.assert.collect();
    })
]);
