import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test } from '@overkill-dev/test';
import { runWithAttachmentContext } from '../../../attachments/attachment-context.ts';

import {
    type TestCase,
    type RunResult,
    createRoot,
    createTestPlan,
    execute
} from '../../../packages/engine/engine.entry-point.ts';

import {
    benchmark,
    asyncMeasurementStrategy,
    defaultRuntimeCooldownPolicy,
    defaultSamplingPolicy,
    rawMeasurement,
    timelineMeasurement,
    wallClockMeasurement,
    workload,
    type BenchmarkMeasureContext
} from '../../../packages/bench/bench.entry-point.ts';
import { benchmarkResultSchema } from '../../../run/benchmark-result-schema.ts';
import { defineResource, withResource } from '../../../packages/test/resources.entry-point.ts';

async function executeBenchmark(node: TestCase): Promise<RunResult> {
    return await runWithAttachmentContext(null, async function executeWithoutArtifacts() {
        return await execute(
            createTestPlan(createRoot({ annotations: {}, controls: {}, title: 'root', children: [ node ] }))
        );
    });
}

const assertFirstWorkload = defineCompositeAssertion({
    name: 'first workload',
    assert(check, result: RunResult) {
        const first = result.perTest[0];
        if (first?.benchmark === undefined || first.benchmark === null) {
            throw new Error('Missing benchmark summary.');
        }
        return check.group([
            check.equal(first.benchmark.samples, 128),
            check.equal(first.benchmark.metrics.size?.median, 1),
            check.equal(first.attempts[0].benchmark?.status, 'complete')
        ]);
    }
});

const assertBoundedTimeline = defineCompositeAssertion({
    name: 'bounded timeline',
    assert(check, result: RunResult) {
        const measured = result.perTest[0]?.benchmark;
        if (measured === undefined || measured === null) {
            return check.defined(measured);
        }
        const { timeline } = measured;
        if (timeline === null) {
            return check.defined(timeline);
        }
        return check.group([
            check.equal(measured.samples, 2),
            check.equal(timeline.events, 3),
            check.equal(timeline.status, 'omitted'),
            check.true(timeline.omitted > 0)
        ]);
    }
});

const assertCompletedCooldown = defineCompositeAssertion({
    name: 'completed cooldown',
    assert(check, result: RunResult) {
        const cooldown = result.perTest[0]?.benchmark?.lifecycle?.cooldown;
        if (cooldown?.mode !== 'runtime') {
            throw new Error('Expected retained runtime cooldown evidence.');
        }
        return check.group([ check.equal(cooldown.completed, 35), check.equal(cooldown.outcome, 'settled') ]);
    }
});

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
            lifecycle: {
                garbageCollection: 'off',
                warmupSamples: 33,
                cooldown: { mode: 'runtime', maximumEventLoopUtilization: 1, timeoutMilliseconds: 60_000 }
            },
            sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
        }));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert(assertBoundedTimeline, result);
        scope.assert.equal(cleanups, 35);
        scope.assert(assertCompletedCooldown, result);
        return scope.assert.collect();
    }),
    test('runs native cooldown after cleanup without leaking resources', async function (scope) {
        const result = await executeBenchmark(benchmark('runtime settling', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.cleanup(async function () {
                    await Promise.resolve();
                });
                const measured = sample.measure(function operation() {
                    return 1;
                });
                return { value: measured.value };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
        }, {
            annotations: {},
            controls: {},
            lifecycle: {
                garbageCollection: 'profile-default',
                warmupSamples: 0,
                cooldown: { ...defaultRuntimeCooldownPolicy, maximumEventLoopUtilization: 1 }
            },
            sampling: { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 }
        }));
        const measured = result.perTest[0]?.benchmark;
        const cooldown = measured?.lifecycle?.cooldown;
        if (cooldown?.mode !== 'runtime') {
            throw new Error('Expected runtime cooldown evidence.');
        }
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.partialDeepEqual(cooldown, { completed: 2, windows: 4, outcome: 'settled' });
        scope.assert.true(cooldown.durationMicroseconds >= 200_000);
        scope.assert.deepEqual(result.runnerErrors, []);
        scope.assert.equal(benchmarkResultSchema.parse(measured).lifecycle?.cooldown.mode, 'runtime');
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
        scope.assert(assertFirstWorkload, result);
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
