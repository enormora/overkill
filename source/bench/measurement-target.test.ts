import { type TestScope, suite as authoredSuite, test } from '@overkill-dev/test';

import { canonicalJson } from '../canonical-identity.ts';
import type { MeasurementEvidence } from '../engine/measurement-evidence.ts';

import { type TestCase, createRoot, createTestPlan, execute } from '../packages/engine/engine.entry-point.ts';

import {
    benchmark,
    workload,
    rawMeasurement,
    withMeasurementTarget,
    wallClockMeasurement,
    defaultSamplingPolicy,
    measurementStrategy,
    threadCpuCollector
} from '../packages/bench/bench.entry-point.ts';
import { benchmarkResultSchema } from '../run/benchmark-result-schema.ts';
import { createMeasurementSample } from './measurement-region.ts';
import { defaultMeasurementTarget, readMeasurementTarget, type MeasurementTarget } from './measurement-target.ts';
import { resolveCalibratedMeasurement } from './calibrated-measurement.ts';
import { currentMeasurementContext } from './measurement-context.ts';

const sampling = { ...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2 };
async function runBenchmark(node: TestCase): Promise<Awaited<ReturnType<typeof execute>>> {
    return await execute(
        createTestPlan(createRoot({ title: 'targets', annotations: {}, controls: {}, children: [ node ] }))
    );
}
function targetWithClock(now: () => number): MeasurementTarget {
    const target = defaultMeasurementTarget();
    return {
        ...target,
        identity: { ...target.identity, name: 'target', semantics: { instrumentation: 'local-v1' } },
        normalization: 'raw',
        nowMicroseconds: now
    };
}
function assertInvocationOrder(scope: TestScope, evidence: MeasurementEvidence): void {
    scope.assert.deepEqual(
        evidence.invocations.map(function identity(entry) {
            return [ entry.invocation.phase, entry.invocation.index, entry.invocation.attempt.index ];
        }),
        [ [ 'warmup', 0, 0 ], [ 'measured', 0, 0 ], [ 'measured', 1, 0 ] ]
    );
    scope.assert.true(evidence.invocations.every(function sameTarget(entry) {
        return entry.target.name === 'target' && entry.status === 'complete';
    }));
}
export const testNode = authoredSuite('measurement targets and attribution', [
    test('allocates distinct measurement IDs under microtest policy', function (scope: TestScope) {
        const executionIds = new Set<string>();
        for (let invocation = 0; invocation < 129; invocation += 1) {
            executionIds.add(currentMeasurementContext().invocation.execution);
        }
        scope.assert.equal(executionIds.size, 129);
        return scope.assert.collect();
    }),
    test('rejects reversed and nonfinite target clock intervals', function (scope) {
        for (const stopped of [ 9, Number.NaN ]) {
            let readings = 0;
            const target = targetWithClock(function readTargetClock() {
                readings += 1;
                return readings === 1 ? 10 : stopped;
            });
            const strategy = withMeasurementTarget(target, wallClockMeasurement());
            scope.assert.throws(function () {
                createMeasurementSample(strategy, scope.signal).sample.measure(function () {
                    return 1;
                });
            }, { message: 'Measurement clock must produce a finite nonnegative interval.' });
        }
        return scope.assert.collect();
    }),
    test('requires explicit target names and clock domains', function (scope: TestScope) {
        const target = defaultMeasurementTarget();
        for (const identity of [ { ...target.identity, name: '' }, { ...target.identity, clock: '' } ]) {
            scope.assert.throws(function () {
                withMeasurementTarget({ ...target, identity }, wallClockMeasurement());
            }, { message: 'Measurement targets require a name and clock domain.' });
        }
        return scope.assert.collect();
    }),
    test('rejects host CPU metrics for another runtime or target instance', function (scope: TestScope) {
        const target = defaultMeasurementTarget();
        for (const identity of [ { ...target.identity, scope: 'remote' }, { ...target.identity, instance: 'other' } ]) {
            let operations = 0;
            const strategy = withMeasurementTarget(
                { ...target, identity },
                measurementStrategy([ threadCpuCollector() ])
            );
            scope.assert.throws(function () {
                createMeasurementSample(strategy, scope.signal).sample.measure(function () {
                    operations += 1;
                });
            }, { message: 'Node collectors require the executing runtime as their measured target.' });
            scope.assert.equal(operations, 0);
        }
        return scope.assert.collect();
    }),
    test('uses the selected clock without adding a promise to synchronous work', function (scope: TestScope) {
        let clock = 0;
        const target = targetWithClock(function readTargetClock() {
            clock += 25;
            return clock;
        });
        const measured = createMeasurementSample(withMeasurementTarget(target, wallClockMeasurement()), scope.signal)
            .sample
            .measure(function () {
                return 7;
            });
        scope.assert.false(measured instanceof Promise);
        scope.assert.equal(measured.value, 7);
        scope.assert.partialDeepEqual(measured.metrics.durationMicroseconds, { availability: 'available', value: 25 });
        return scope.assert.collect();
    }),
    test('preserves explicit targets through raw normalization resolution', function (scope: TestScope) {
        const target = targetWithClock(function readTargetClock() {
            return 0;
        });
        const resolved = resolveCalibratedMeasurement(
            rawMeasurement(withMeasurementTarget(target, wallClockMeasurement())),
            new Set([ 'durationMicroseconds' ])
        );
        scope.assert.true(readMeasurementTarget(resolved.measurement) === target);
        scope.assert.deepEqual(resolved.normalization, {});
        return scope.assert.collect();
    }),
    test('does not apply CPU normalization to an unrelated target', function (scope: TestScope) {
        const target = targetWithClock(function readTargetClock() {
            return 0;
        });
        const resolved = resolveCalibratedMeasurement(
            withMeasurementTarget(target, wallClockMeasurement()),
            new Set([ 'durationMicroseconds' ])
        );
        scope.assert.deepEqual(resolved.normalization, {});
        return scope.assert.collect();
    }),
    test('applies GC and cooldown to the target after cleanup for every invocation', async function (scope: TestScope) {
        const events: string[] = [];
        const initial = targetWithClock(function readTargetClock() {
            return performance.now() * 1000;
        });
        const target: MeasurementTarget = {
            ...initial,
            garbageCollection: {
                kind: 'available',
                run() {
                    events.push('gc');
                }
            },
            cooldown: {
                kind: 'available',
                async run(_policy, _signal, previous) {
                    events.push('cooldown');
                    return {
                        evidence: { ...previous, completed: previous.completed + 1, outcome: 'settled' },
                        error: null
                    };
                }
            }
        };
        const result = await runBenchmark(benchmark('target lifecycle', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: rawMeasurement(withMeasurementTarget(target, wallClockMeasurement())),
            measure({ sample }) {
                sample.cleanup(function cleanupSample() {
                    events.push('cleanup');
                });
                const measured = sample.measure(function () {
                    events.push('operation');
                    return 1;
                });
                return { value: measured.value };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { minimum: 1, maximum: 1, statistic: { kind: 'observed-maximum' } } } }
        }, {
            annotations: {},
            controls: {},
            sampling,
            lifecycle: {
                warmupSamples: 1,
                garbageCollection: 'after-sample',
                cooldown: { mode: 'runtime', maximumEventLoopUtilization: 1, timeoutMilliseconds: 1000 }
            }
        }));
        scope.assert.equal(result.summary.passed, 1);
        scope.assert.deepEqual(
            events,
            Array
                .from({ length: 3 }, function invocationEvents() {
                    return [ 'operation', 'cleanup', 'gc', 'cooldown' ];
                })
                .flat()
        );
        const evidence = result.perTest[0]?.benchmark?.lifecycle?.measurement;
        scope.require.defined(evidence);
        assertInvocationOrder(scope, evidence);
        return scope.assert.collect();
    }),
    test('rejects unavailable target capabilities before warmup', async function (scope: TestScope) {
        let operations = 0;
        const initial = targetWithClock(function readTargetClock() {
            return 0;
        });
        const target: MeasurementTarget = {
            ...initial,
            cooldown: { kind: 'unavailable', reason: 'No target settling' }
        };
        const result = await runBenchmark(benchmark('unsupported settling', {
            kind: 'runtime',
            workloads: [ workload('one', {}) ],
            measurement: rawMeasurement(withMeasurementTarget(target, wallClockMeasurement())),
            measure({ sample }) {
                return {
                    value: sample
                        .measure(function () {
                            operations += 1;
                            return 1;
                        })
                        .value
                };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
        }, {
            annotations: {},
            controls: {},
            sampling,
            lifecycle: {
                warmupSamples: 1,
                garbageCollection: 'off',
                cooldown: { mode: 'runtime', maximumEventLoopUtilization: 1, timeoutMilliseconds: 1000 }
            }
        }));
        scope.assert.equal(operations, 0);
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.partialDeepEqual(result.runnerErrors, [ {
            message: 'No target settling',
            subtype: 'measurement'
        } ]);
        scope.assert.equal(result.perTest[0]?.benchmark?.status, 'incomplete');
        return scope.assert.collect();
    }),
    test(
        'rejects independently versioned lifecycle evidence',
        async function (scope: TestScope) {
            const result = await runBenchmark(benchmark('historical', {
                kind: 'runtime',
                workloads: [ workload('one', {}) ],
                measurement: rawMeasurement(wallClockMeasurement()),
                measure({ sample }) {
                    return {
                        value: sample
                            .measure(function () {
                                return 1;
                            })
                            .value
                    };
                },
                diagnosticMetrics: [],
                budgets: { one: { value: { maximum: 2, statistic: { kind: 'observed-maximum' } } } }
            }, {
                annotations: {},
                controls: {},
                sampling,
                lifecycle: { warmupSamples: 0, garbageCollection: 'off', cooldown: { mode: 'off' } }
            }));
            const measured = result.perTest[0]?.benchmark;
            scope.require.defined(measured);
            scope.require.defined(measured.lifecycle);
            const { measurement: _measurement, ...lifecycle } = measured.lifecycle;
            scope.assert.throws(function historicalLifecycle() {
                benchmarkResultSchema.parse({ ...measured, lifecycle: { ...lifecycle, version: 2 } });
            }, { name: 'ZodError' });
            scope.assert.equal(canonicalJson(benchmarkResultSchema.parse(measured)), canonicalJson(measured));
            return scope.assert.collect();
        }
    )
]);
