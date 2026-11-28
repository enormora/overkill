import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import * as standard from '../test/bench.entry-point.ts';
import { defineResource, withResource } from '../test/resources.entry-point.ts';
import { isAssignableTo, isEqualTo } from '../../test-support/type-relations.ts';
import * as bench from './bench.entry-point.ts';

const entries = 3;
const operationCount = 2;
const asyncValue = 7;

declare const callUnderTest: bench.MeasurementSample['measure'];

export const testNode = suite('benchmark measurement authoring', [
    test('provides a process-only sample for process strategies', function (scope) {
        bench.benchmark('command', {
            kind: 'startup',
            workloads: [ bench.workload('one', {}) ],
            measurement: bench.processMeasurement({ instrumentation: 'off' }),
            async measure({ sample }) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<bench.BenchmarkSample<bench.ProcessSample>>()(sample)
                );
                scope.assert(assignableFrom.not<keyof typeof sample, 'measure'>());
                const measured = await sample.process({
                    command: [ 'node', 'cli.js' ],
                    cwd: '.',
                    env: null,
                    io: { kind: 'pipes' },
                    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<bench.MeasuredProcess>()(measured));
                return { durationMicroseconds: measured.metrics.durationMicroseconds };
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 100 } } }
        });
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<typeof bench.processMeasurement>()(standard.processMeasurement)
        );
        scope.assert(assignableFrom.not<keyof bench.MeasurementSample, 'process'>());
        return scope.assert.collect();
    }),
    test('infers workload parameters and synchronous region values', function (scope) {
        const node = bench.benchmark('serialize', {
            kind: 'runtime',
            workloads: [ bench.workload('small', { entries }) ],
            measurement: bench.wallClockMeasurement(),
            measure(context) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<typeof entries>()(context.workload.parameters.entries)
                );
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<(callback: () => Promise<void> | void) => void>()(context.sample.cleanup)
                );
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<bench.BenchmarkLifecyclePolicy>()(standard.defaultBenchmarkLifecyclePolicy)
                );
                const measured = context.sample.measure(function () {
                    return 'result';
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<bench.Measured<string>>()(measured));
                scope.assert(assignableFrom.not<keyof typeof context, 'assert'>());
                scope.assert(assignableFrom.not<keyof typeof context, 'plan'>());
                return { durationMicroseconds: measured.metrics.durationMicroseconds };
            },
            diagnosticMetrics: [],
            budgets: { small: { durationMicroseconds: { maximum: 100 } } }
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<bench.TestCase>()(node));
        scope.assert(sameType<IsEqual<typeof standard.benchmark, typeof bench.benchmark>, true>());
        return scope.assert.collect();
    }),
    test('distinguishes async operations and strategies from synchronous regions', function (scope) {
        bench.benchmark('async operation', {
            kind: 'throughput',
            workloads: [ bench.workload('one', {}) ],
            measurement: bench.wallClockMeasurement(),
            async measure({ sample }) {
                const measured = sample.measure(async function () {
                    return asyncValue;
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<Promise<bench.Measured<number>>>()(measured));
                const result = await measured;
                return { operationsPerSecond: result.metrics.operationsPerSecond };
            },
            diagnosticMetrics: [],
            budgets: { one: { operationsPerSecond: { minimum: 1 } } }
        });
        bench.benchmark('async strategy', {
            kind: 'responsiveness',
            workloads: [ bench.workload('one', {}) ],
            measurement: bench.asyncMeasurementStrategy([ bench.runtimeHealthCollector() ]),
            async measure({ sample }) {
                const measured = sample.measure(operationCount, function () {
                    return true;
                });
                scope.assert(sameType.withActual<true>(), isEqualTo<Promise<bench.Measured<boolean>>>()(measured));
                const result = await measured;
                return { value: Number(result.value) };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 1 } } }
        });
        return scope.assert.collect();
    }),
    test('preserves metric results through resource wrappers', function (scope) {
        const resource = defineResource({
            name: 'fixture',
            scope: 'per-case',
            requirements: [],
            acquire() {
                return { size: 2 };
            },
            dispose() {
                return undefined;
            }
        });
        const measure = withResource<
            typeof resource,
            bench.BenchmarkMeasureContext<{ readonly size: number; }>,
            { readonly size: number; }
        >(resource, function (context) {
            scope.assert(sameType.withActual<number>(), context.resources.fixture.size);
            const measured = context.sample.measure(function () {
                return context.resources.fixture.size;
            });
            return { size: measured.value };
        });
        scope.assert(
            sameType.withActual<true>(),
            isAssignableTo<
                (
                    context: bench.BenchmarkMeasureContext<{ readonly size: number; }>
                ) => Promise<{ readonly size: number; }>
            >()(measure)
        );
        bench.benchmark('contextual resource', {
            kind: 'memory',
            workloads: [ bench.workload('one', { size: operationCount }) ],
            measurement: bench.wallClockMeasurement(),
            measure: withResource<
                typeof resource,
                bench.BenchmarkMeasureContext<{ readonly size: typeof operationCount; }>,
                bench.BenchmarkMetrics
            >(resource, function (context) {
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<typeof operationCount>()(context.workload.parameters.size)
                );
                scope.assert(assignableFrom.not<keyof typeof context, 'assert'>());
                const measured = context.sample.measure(function () {
                    return context.resources.fixture.size;
                });
                return { size: measured.value };
            }),
            diagnosticMetrics: [],
            budgets: { one: { size: { maximum: operationCount } } }
        });
        scope.assert(rejectsCall('no-matching-overload'), function () {
            return callUnderTest('invalid');
        });
        scope.assert(rejectsCall('no-matching-overload'), function () {
            return callUnderTest(operationCount);
        });
        return scope.assert.collect();
    })
]);
