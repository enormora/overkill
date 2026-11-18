import {
    workload,
    type MeasurementStrategy,
    type ProcessMeasurementStrategy
} from '../packages/bench/bench.entry-point.ts';
import {
    resolveBenchmarkDefinition,
    type ResolvedBenchmarkDefinition
} from '../bench/benchmark-definition-resolution.ts';
import { options } from './normalized-machine.ts';

export function normalizationDefinition(
    measurement: MeasurementStrategy | ProcessMeasurementStrategy
): ResolvedBenchmarkDefinition {
    return resolveBenchmarkDefinition({
        kind: 'runtime',
        workloads: [ workload('one', {}) ],
        measurement,
        diagnosticMetrics: [ 'operationsPerSecond', 'bytes' ],
        budgets: { one: { durationMicroseconds: { maximum: 20 }, processCpuTotalMicroseconds: { maximum: 20 } } }
    }, options);
}
