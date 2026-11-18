import { monitorEventLoopDelay, performance as runtimePerformance } from 'node:perf_hooks';

import type { MetricReading } from '../engine/benchmark-metrics.ts';
import type { NodeProbeReport } from './process-node-readings.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { bytesPerBinaryKilobyte, nanosecondsPerMicrosecond } from './measurement-units.ts';

export type NodeChildObservationRuntime = {
    readonly histogram: () => Pick<
        ReturnType<typeof monitorEventLoopDelay>,
        'count' | 'disable' | 'enable' | 'max' | 'mean' | 'percentile'
    >;
    readonly utilization: typeof runtimePerformance.eventLoopUtilization;
    readonly now: () => bigint;
    readonly cpu: () => Pick<ReturnType<typeof process.cpuUsage>, 'system' | 'user'>;
    readonly memory: () => Pick<ReturnType<typeof process.memoryUsage>, 'heapUsed' | 'rss'>;
    readonly maximumResidentSetKilobytes: () => number;
    readonly version: string;
};
type ChildRuntimeObservation = {
    readonly histogram: ReturnType<NodeChildObservationRuntime['histogram']>;
    readonly utilization: ReturnType<typeof runtimePerformance.eventLoopUtilization>;
    readonly started: bigint;
};
export type NodeChildObservation = {
    readonly snapshot: () => NodeProbeReport;
    readonly dispose: () => void;
};
const percentile95 = 95;

type ChildCpuMetrics = Pick<
    NodeProbeReport['metrics'],
    'processCpuSystemMicroseconds' | 'processCpuTotalMicroseconds' | 'processCpuUserMicroseconds'
>;
type ChildMemoryMetrics = Pick<
    NodeProbeReport['metrics'],
    'heapUsedBytes' | 'processMaximumResidentSetBytes' | 'residentSetBytes'
>;
type LoopDelayMetric = 'eventLoopDelayMaximumMicroseconds' | 'eventLoopDelayMeanMicroseconds';
type LoopMetric = LoopDelayMetric | 'eventLoopDelayPercentile95Microseconds' | 'eventLoopUtilization';
type ChildRuntimeMetrics = Pick<NodeProbeReport['metrics'], LoopMetric>;

function childCpuMetrics(runtime: NodeChildObservationRuntime): ChildCpuMetrics {
    const cpu = runtime.cpu();
    const provenance = { collector: 'node-child-cpu-v1', scope: 'process' as const, unit: 'microseconds' };
    return {
        processCpuUserMicroseconds: availableMetric(cpu.user, provenance),
        processCpuSystemMicroseconds: availableMetric(cpu.system, provenance),
        processCpuTotalMicroseconds: availableMetric(cpu.user + cpu.system, provenance)
    };
}

function childMemoryMetrics(runtime: NodeChildObservationRuntime): ChildMemoryMetrics {
    const memory = runtime.memory();
    const provenance = { collector: 'node-child-memory-v1', scope: 'process' as const, unit: 'bytes' };
    return {
        residentSetBytes: availableMetric(memory.rss, provenance),
        heapUsedBytes: availableMetric(memory.heapUsed, { ...provenance, scope: 'thread' }),
        processMaximumResidentSetBytes: availableMetric(
            runtime.maximumResidentSetKilobytes() * bytesPerBinaryKilobyte,
            provenance
        )
    };
}

function childLoopDelay(histogram: ChildRuntimeObservation['histogram'], value: number): MetricReading {
    const provenance = { collector: 'node-child-runtime-v1', scope: 'runtime' as const, unit: 'microseconds' };
    return histogram.count === 0
        ? unavailableMetric('No event-loop observations were collected.', provenance)
        : availableMetric(value / nanosecondsPerMicrosecond, provenance);
}

function childRuntimeMetrics(
    observation: ChildRuntimeObservation,
    runtime: NodeChildObservationRuntime
): ChildRuntimeMetrics {
    const { histogram, utilization } = observation;
    return {
        eventLoopDelayMeanMicroseconds: childLoopDelay(histogram, histogram.mean),
        eventLoopDelayMaximumMicroseconds: childLoopDelay(histogram, histogram.max),
        eventLoopDelayPercentile95Microseconds: childLoopDelay(histogram, histogram.percentile(percentile95)),
        eventLoopUtilization: availableMetric(runtime.utilization(utilization).utilization, {
            collector: 'node-child-runtime-v1',
            scope: 'thread',
            unit: 'ratio'
        })
    };
}

export function observeChildRuntime(runtime: NodeChildObservationRuntime): NodeChildObservation {
    const observation = {
        histogram: runtime.histogram(),
        started: runtime.now(),
        utilization: runtime.utilization()
    };
    observation.histogram.enable();
    return {
        snapshot() {
            return {
                version: 1,
                runtime: runtime.version,
                observationMicroseconds: Number(runtime.now() - observation.started) /
                    nanosecondsPerMicrosecond,
                metrics: {
                    ...childCpuMetrics(runtime),
                    ...childMemoryMetrics(runtime),
                    ...childRuntimeMetrics(observation, runtime)
                }
            };
        },
        dispose() {
            observation.histogram.disable();
        }
    };
}

export function observeNodeChild(): NodeChildObservation {
    return observeChildRuntime({
        histogram() {
            return monitorEventLoopDelay({ samplePerIteration: true });
        },
        utilization: runtimePerformance.eventLoopUtilization,
        now: process.hrtime.bigint,
        cpu: process.cpuUsage,
        memory: process.memoryUsage,
        maximumResidentSetKilobytes() {
            return process.resourceUsage().maxRSS;
        },
        version: process.version
    });
}
