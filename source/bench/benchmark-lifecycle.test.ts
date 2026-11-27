import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { type TestScope, suite, test } from '@overkill-dev/test';

import { benchmarkLifecyclePolicySchema } from '../run/benchmark-policy-schema.ts';
import { type TestCase, createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';

import {
    benchmark,
    defaultSamplingPolicy,
    defaultBenchmarkLifecyclePolicy,
    wallClockMeasurement,
    workload,
    type BenchmarkDefinition,
    type BenchmarkOptions
} from '../packages/bench/bench.entry-point.ts';
import type { BenchmarkExecutionResult, BenchmarkLifecycleResult } from '../engine/benchmark-result.ts';
import { CaseRunnerError, type RunResult, type TestOutcome } from '../engine/run-result.ts';
import { benchmarkResultSchema } from '../run/benchmark-result-schema.ts';

const shortSampling = { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 };
const measuredOnly: BenchmarkOptions = {
    annotations: {},
    controls: {},
    sampling: shortSampling,
    lifecycle: { garbageCollection: 'profile-default', warmupSamples: 0, cooldown: { mode: 'off' } }
};

async function runBenchmark(node: TestCase): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(createTestPlan(createRoot({
        annotations: {},
        controls: {},
        title: 'root',
        children: [ node ]
    })));
}

function measurementResult(
    result: RunResult
): BenchmarkExecutionResult & { readonly lifecycle: BenchmarkLifecycleResult; } {
    const measured = result.perTest[0]?.benchmark;
    if (measured?.lifecycle === undefined || measured.lifecycle === null) {
        throw new Error('Expected benchmark lifecycle evidence.');
    }
    return { ...measured, lifecycle: measured.lifecycle };
}

type NoParameters = Readonly<Record<string, never>>;

function valueBenchmark(measure: BenchmarkDefinition<NoParameters>['measure']): BenchmarkDefinition<NoParameters> {
    return {
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement: wallClockMeasurement(),
        measure,
        diagnosticMetrics: [],
        budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
    };
}

function failureOutcome(result: RunResult): Extract<TestOutcome, { readonly kind: 'fail'; }> {
    const outcome = result.perTest[0]?.outcome;
    if (outcome?.kind !== 'fail') {
        throw new Error('Expected benchmark cleanup failure.');
    }
    return outcome;
}

const assertAutomaticWarmup = defineCompositeAssertion({
    name: 'automatic warmup',
    assert(check, result: RunResult) {
        const measured = measurementResult(result);
        const initialChecks = check.group([
            check.partialDeepEqual(measured, {
                samples: 2,
                metrics: { value: { maximum: 1 } },
                lifecycle: { warmup: { samples: 32, metrics: { value: { maximum: 1000 } } } }
            }),
            check.deepEqual(measured.lifecycle.policy, { ...defaultBenchmarkLifecyclePolicy, garbageCollection: 'off' })
        ]);
        const attempt = result.perTest[0]?.attempts[0].benchmark;
        if (attempt === undefined || attempt === null) {
            return check.group([ initialChecks, check.defined(attempt) ]);
        }
        return check.group([ initialChecks, check.defined(attempt), check.deepEqual(attempt, measured) ]);
    }
});

export const testNode = suite('benchmark invocation lifetimes', [
    test(
        'rejects invalid cleanup callbacks while releasing already registered resources',
        async function (scope) {
            let cleanups = 0;
            const result = await runBenchmark(benchmark(
                'invalid cleanup',
                valueBenchmark(function ({ sample }) {
                    sample.cleanup(function releaseResource() {
                        cleanups += 1;
                    });
                    const measured = sample.measure(function () {
                        return 1;
                    });
                    Reflect.apply(sample.cleanup, undefined, [ null ]);
                    return { value: measured.value };
                }),
                measuredOnly
            ));
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.equal(cleanups, 1);
            scope.assert.partialDeepEqual(failureOutcome(result), {
                failures: [ { kind: 'body-error', error: { message: 'sample.cleanup() requires a callback.' } } ]
            });
            scope.assert.deepEqual(measurementResult(result).lifecycle.cleanup, { callbacks: 1, failures: 0 });
            return scope.assert.collect();
        }
    ),
    test('preserves established budget failures through a measurement interruption', async function (scope) {
        let calls = 0;
        const result = await runBenchmark(benchmark('interrupted budgets', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: wallClockMeasurement(),
            measure({ sample }) {
                sample.measure(function () {
                    return 1;
                });
                calls += 1;
                if (calls === 129) {
                    throw new CaseRunnerError('Runtime observation unavailable.', {
                        subtype: 'measurement',
                        cause: null
                    });
                }
                return { failed: 2, unresolved: calls % 2 };
            },
            diagnosticMetrics: [],
            budgets: { one: { failed: { maximum: 1 }, unresolved: { maximum: 0.5 } } }
        }, { ...measuredOnly, sampling: { ...defaultSamplingPolicy, maximumSamples: 256 } }));
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(measurementResult(result).samples, 128);
        scope.assert.partialDeepEqual(failureOutcome(result), { failures: [ { kind: 'assertion' } ] });
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'measurement');
        return scope.assert.collect();
    }),
    test('validates lifecycle policy at authoring without invoking the workload', function (scope) {
        let calls = 0;
        const definition = valueBenchmark(function ({ sample }) {
            calls += 1;
            return {
                value: sample
                    .measure(function () {
                        return 1;
                    })
                    .value
            };
        });
        for (const warmupSamples of [ -1, 0.5, 65_537 ]) {
            scope.assert.throws(function () {
                benchmark(
                    'invalid lifecycle',
                    definition,
                    {
                        ...measuredOnly,
                        lifecycle: { garbageCollection: 'profile-default', warmupSamples, cooldown: { mode: 'off' } }
                    }
                );
            }, { name: 'ZodError' });
            scope.assert.false(
                benchmarkLifecyclePolicySchema.safeParse({ warmupSamples, cooldown: { mode: 'off' } }).success
            );
        }
        scope.assert.equal(calls, 0);
        return scope.assert.collect();
    }),
    test(
        'warms automatically and excludes warmup values from budgets and measured counts',
        async function (scope) {
            let calls = 0;
            const node = benchmark(
                'automatic',
                valueBenchmark(function ({ sample }) {
                    calls += 1;
                    return {
                        value: sample
                            .measure(function () {
                                return calls <= 32 ? 1000 : 1;
                            })
                            .value
                    };
                }),
                { annotations: {}, controls: {}, sampling: shortSampling }
            );
            const result = await runBenchmark(node);
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.equal(calls, 34);
            scope.assert(assertAutomaticWarmup, result);
            return scope.assert.collect();
        }
    ),
    test('supports cold-start opt-out and preserves synchronous measured values', async function (scope) {
        let calls = 0;
        const result = await runBenchmark(benchmark(
            'cold',
            valueBenchmark(function ({ sample }) {
                const measured = sample.measure(function () {
                    calls += 1;
                    return calls;
                });
                return { value: measured.value };
            }),
            measuredOnly
        ));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(calls, 2);
        scope.assert.equal(result.perTest[0]?.benchmark?.lifecycle?.warmup.samples, 0);
        return scope.assert.collect();
    }),
    test(
        'cleans every invocation in reverse order before the next preparation and attempt cleanup',
        async function (scope) {
            const events: string[] = [];
            let calls = 0;
            const result = await runBenchmark(benchmark(
                'order',
                valueBenchmark(function ({ sample, cleanup }) {
                    calls += 1;
                    const index = calls;
                    events.push(`prepare:${index}`);
                    sample.cleanup(function () {
                        events.push(`first:${index}`);
                    });
                    sample.cleanup(async function () {
                        await Promise.resolve();
                        events.push(`second:${index}`);
                    });
                    cleanup(function () {
                        events.push(`attempt:${index}`);
                    });
                    return {
                        value: sample
                            .measure(function () {
                                events.push(`measure:${index}`);
                                return 1;
                            })
                            .value
                    };
                }),
                {
                    ...measuredOnly,
                    lifecycle: { garbageCollection: 'profile-default', warmupSamples: 1, cooldown: { mode: 'off' } }
                }
            ));
            scope.assert.equal(result.summary.passed, 1);
            scope.assert.deepEqual(events, [
                'prepare:1',
                'measure:1',
                'second:1',
                'first:1',
                'prepare:2',
                'measure:2',
                'second:2',
                'first:2',
                'prepare:3',
                'measure:3',
                'second:3',
                'first:3',
                'attempt:3',
                'attempt:2',
                'attempt:1'
            ]);
            scope.assert.deepEqual(measurementResult(result).lifecycle.cleanup, { callbacks: 6, failures: 0 });
            return scope.assert.collect();
        }
    ),
    test(
        'retains completed readings and all cleanup failures while stopping further sampling',
        async function (scope) {
            let calls = 0;
            const result = await runBenchmark(benchmark(
                'failed cleanup',
                valueBenchmark(function ({ sample }) {
                    calls += 1;
                    sample.cleanup(function () {
                        throw new Error('first cleanup');
                    });
                    sample.cleanup(function () {
                        throw new Error('second cleanup');
                    });
                    return {
                        value: sample
                            .measure(function () {
                                return 1;
                            })
                            .value
                    };
                }),
                measuredOnly
            ));
            const measured = measurementResult(result);
            scope.assert.equal(calls, 1);
            scope.assert.equal(result.summary.failed, 1);
            scope.assert.partialDeepEqual(measured, {
                samples: 1,
                status: 'incomplete',
                metrics: { value: { count: 1 } },
                lifecycle: { cleanup: { callbacks: 2, failures: 2 } }
            });
            scope.assert.partialDeepEqual(failureOutcome(result), {
                kind: 'fail',
                failures: [
                    { kind: 'cleanup-error', error: { message: 'second cleanup' } },
                    { kind: 'cleanup-error', error: { message: 'first cleanup' } }
                ]
            });
            return scope.assert.collect();
        }
    ),
    test('cleans failed warmup preparation and preserves body and cleanup errors', async function (scope) {
        const result = await runBenchmark(benchmark(
            'failed preparation',
            valueBenchmark(function ({ sample }) {
                sample.cleanup(function () {
                    throw new Error('cleanup failed');
                });
                throw new Error('preparation failed');
            })
        ));
        const measured = measurementResult(result);
        scope.assert.equal(measured.samples, 0);
        scope.assert.equal(measured.lifecycle.warmup.samples, 0);
        scope.assert.partialDeepEqual(failureOutcome(result), {
            kind: 'fail',
            failures: [
                { kind: 'body-error', error: { message: 'preparation failed' } },
                { kind: 'cleanup-error', error: { message: 'cleanup failed' } }
            ]
        });
        return scope.assert.collect();
    }),
    test('rejects late cleanup registration and still executes remaining callbacks', async function (scope) {
        let completed = false;
        const result = await runBenchmark(benchmark(
            'late registration',
            valueBenchmark(function ({ sample }) {
                sample.cleanup(function () {
                    completed = true;
                });
                sample.cleanup(function () {
                    sample.cleanup(function () {
                        return undefined;
                    });
                });
                return {
                    value: sample
                        .measure(function () {
                            return 1;
                        })
                        .value
                };
            }),
            measuredOnly
        ));
        scope.assert.true(completed);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(measurementResult(result).lifecycle.cleanup, { callbacks: 2, failures: 1 });
        return scope.assert.collect();
    }),
    test(
        'decodes historical benchmark evidence without inventing lifecycle observations',
        async function (scope: TestScope) {
            const result = await runBenchmark(benchmark(
                'historical',
                valueBenchmark(function ({ sample }) {
                    return {
                        value: sample
                            .measure(function () {
                                return 1;
                            })
                            .value
                    };
                }),
                measuredOnly
            ));
            const measured = measurementResult(result);
            scope.require.defined(measured);
            const { lifecycle: _lifecycle, ...historical } = measured;
            scope.assert.equal(benchmarkResultSchema.parse(historical).lifecycle, null);
            return scope.assert.collect();
        }
    )
]);
