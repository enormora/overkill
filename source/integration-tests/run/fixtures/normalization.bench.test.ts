import {
    type BenchmarkMeasureContext,
    type CalibrationResource,
    type BenchmarkMetrics,
    availableMetric,
    benchmark,
    calibratedMeasurement,
    defaultSamplingPolicy,
    defineCalibrationResource,
    suite,
    wallClockMeasurement,
    workload
} from '../../../packages/bench/bench.entry-point.ts';
import { defineResource } from '../../../packages/resources/resources.entry-point.ts';
import { withResource } from '../../../packages/test/resources.entry-point.ts';

const ticks = defineResource({
    name: 'reference ticks',
    scope: 'shared-per-worker',
    requirements: [],
    dispose: null,
    acquire() { return 200; }
});
function referenceCalibration(name: string): CalibrationResource {
    return defineCalibrationResource({
    workload: workload(name, {iterations: 1}),
    version: '1',
    unit: 'ticks',
    dependencies: {ticks},
    measurement: wallClockMeasurement(),
    measure({sample, dependencies}) {
        const measured = sample.measure(function referenceTicks() {return dependencies.ticks;});
        return availableMetric(measured.value, {collector: 'reference ticks', scope: 'custom', unit: 'ticks'});
    }
}, {
    sampling: {...defaultSamplingPolicy, minimumSamples: 128, maximumSamples: 128},
    lifecycle: {garbageCollection: 'off', warmupSamples: 0, cooldown: {mode: 'off'}}
});
}
const calibration = referenceCalibration('reference ticks');
const secondCalibration = referenceCalibration('second reference ticks');
const measurement = calibratedMeasurement(wallClockMeasurement(), {value: {calibration, scaling: 'proportional'}});
const unrelated = defineResource({
    name: 'unrelated benchmark fixture',
    scope: 'per-case',
    requirements: [],
    dispose: null,
    acquire() {throw new Error('Benchmark fixtures must not be acquired during calibration capture.');}
});
const options = {
    annotations: {},
    controls: {},
    sampling: {...defaultSamplingPolicy, minimumSamples: 2, maximumSamples: 2},
    lifecycle: {garbageCollection: 'off', warmupSamples: 0, cooldown: {mode: 'off'}}
} as const;
export const testNode = suite('normalization', [
    benchmark('normalized metric', {
        kind: 'runtime',
        workloads: [workload('one', {})],
        measurement,
        measure({sample}) {return {value: sample.measure(function measuredValue() {return 100;}).value};},
        diagnosticMetrics: [],
        budgets: {one: {value: {maximum: 0.75, statistic: {kind: 'observed-maximum'}}}}
    }, options),
    benchmark('mixed normalized and raw metrics', {
        kind: 'runtime', workloads: [workload('one', {})], measurement,
        measure({sample}) {
            const value = sample.measure(function measuredValue() {return 100;}).value;
            return {value, constructor: value};
        },
        diagnosticMetrics: [],
        budgets: {one: {
            value: {maximum: 0.75, statistic: {kind: 'observed-maximum'}},
            constructor: {maximum: 150, statistic: {kind: 'observed-maximum' as const}}
        }}
    }, options),
    benchmark('capture multiple references', {
        kind: 'runtime', workloads: [workload('one', {})],
        measurement: calibratedMeasurement(wallClockMeasurement(), {
            value: {calibration, scaling: 'proportional'},
            second: {calibration: secondCalibration, scaling: 'proportional'}
        }),
        measure({sample}) {
            const value = sample.measure(function measuredValue() {return 100;}).value;
            return {value, second: value};
        },
        diagnosticMetrics: [], budgets: {one: {value: {maximum: 0.75}, second: {maximum: 0.75}}}
    }, options),
    benchmark('capture skips benchmark fixtures', {
        kind: 'runtime',
        workloads: [workload('one', {})],
        measurement,
        measure: withResource(unrelated, function benchmarkMustNotRun(context: BenchmarkMeasureContext<Readonly<Record<string, never>>>): BenchmarkMetrics {
            throw new Error(context.signal.aborted ? 'Cancelled' : 'Benchmark callbacks must not execute during calibration capture.');
        }),
        diagnosticMetrics: [],
        budgets: {one: {value: {maximum: 0.75}}}
    }, options)
]);
