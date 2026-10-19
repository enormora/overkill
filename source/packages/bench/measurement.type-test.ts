import { describe, expect, test } from 'tstyche';
import * as standard from '../test/bench.entry-point.ts';
import { defineResource, withResource } from '../test/resources.entry-point.ts';
import * as bench from './bench.entry-point.ts';

const entries = 3;
const operationCount = 2;
const asyncValue = 7;

describe('benchmark measurement authoring', function () {
    test('provides a process-only sample for process strategies', function () {
        bench.benchmark('command', {
            kind: 'startup',
            workloads: [ bench.workload('one', {}) ],
            measurement: bench.processMeasurement({ instrumentation: 'off' }),
            async measure({ sample }) {
                expect(sample).type.toBe<bench.BenchmarkSample<bench.ProcessSample>>();
                expect(sample).type.not.toHaveProperty('measure');
                const measured = await sample.process({
                    command: [ 'node', 'cli.js' ],
                    cwd: '.',
                    env: null,
                    io: { kind: 'pipes' },
                    completion: { kind: 'exit', readiness: null, steps: [], expectedExitCodes: [ 0 ] }
                });
                expect(measured).type.toBe<bench.MeasuredProcess>();
                return { durationMicroseconds: measured.metrics.durationMicroseconds };
            },
            diagnosticMetrics: [],
            budgets: { one: { durationMicroseconds: { maximum: 100 } } }
        });
        expect(standard.processMeasurement).type.toBe<typeof bench.processMeasurement>();
        expect<bench.MeasurementSample>().type.not.toHaveProperty('process');
    });
    test('infers workload parameters and synchronous region values', function () {
        const node = bench.benchmark('serialize', {
            kind: 'runtime',
            workloads: [ bench.workload('small', { entries }) ],
            measurement: bench.wallClockMeasurement(),
            measure(context) {
                expect(context.workload.parameters.entries).type.toBe<typeof entries>();
                expect(context.sample.cleanup).type.toBe<(callback: () => Promise<void> | void) => void>();
                expect(standard.defaultBenchmarkLifecyclePolicy).type.toBe<bench.BenchmarkLifecyclePolicy>();
                const measured = context.sample.measure(function () {
                    return 'result';
                });
                expect(measured).type.toBe<bench.Measured<string>>();
                expect(context).type.not.toHaveProperty('assert');
                expect(context).type.not.toHaveProperty('plan');
                return { durationMicroseconds: measured.metrics.durationMicroseconds };
            },
            diagnosticMetrics: [],
            budgets: { small: { durationMicroseconds: { maximum: 100 } } }
        });
        expect(node).type.toBe<bench.TestCase>();
        expect(standard.benchmark).type.toBe<typeof bench.benchmark>();
    });
    test('distinguishes async operations and strategies from synchronous regions', function () {
        bench.benchmark('async operation', {
            kind: 'throughput',
            workloads: [ bench.workload('one', {}) ],
            measurement: bench.wallClockMeasurement(),
            async measure({ sample }) {
                const measured = sample.measure(async function () {
                    return asyncValue;
                });
                expect(measured).type.toBe<Promise<bench.Measured<number>>>();
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
                expect(measured).type.toBe<Promise<bench.Measured<boolean>>>();
                const result = await measured;
                return { value: Number(result.value) };
            },
            diagnosticMetrics: [],
            budgets: { one: { value: { maximum: 1 } } }
        });
    });
    test('preserves metric results through resource wrappers', function () {
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
            expect(context.resources.fixture.size).type.toBe<number>();
            const measured = context.sample.measure(function () {
                return context.resources.fixture.size;
            });
            return { size: measured.value };
        });
        expect(measure).type.toBeAssignableTo<
            (context: bench.BenchmarkMeasureContext<{ readonly size: number; }>) => Promise<{ readonly size: number; }>
        >();
        bench.benchmark('contextual resource', {
            kind: 'memory',
            workloads: [ bench.workload('one', { size: operationCount }) ],
            measurement: bench.wallClockMeasurement(),
            measure: withResource<
                typeof resource,
                bench.BenchmarkMeasureContext<{ readonly size: typeof operationCount; }>,
                bench.BenchmarkMetrics
            >(resource, function (context) {
                expect(context.workload.parameters.size).type.toBe<typeof operationCount>();
                expect(context).type.not.toHaveProperty('assert');
                const measured = context.sample.measure(function () {
                    return context.resources.fixture.size;
                });
                return { size: measured.value };
            }),
            diagnosticMetrics: [],
            budgets: { one: { size: { maximum: operationCount } } }
        });
        expect<bench.MeasurementSample['measure']>().type.not.toBeCallableWith('invalid');
        expect<bench.MeasurementSample['measure']>().type.not.toBeCallableWith(operationCount);
    });
});
