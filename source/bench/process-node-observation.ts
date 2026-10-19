import { monitorEventLoopDelay, performance as runtimePerformance } from 'node:perf_hooks';
import type { MetricReading } from '../engine/benchmark-result.ts';
import type { NodeProbeReport } from './process-node-readings.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { bytesPerBinaryKilobyte, nanosecondsPerMicrosecond } from './measurement-units.ts';

type ChildRuntimeObservation = {
    readonly histogram: ReturnType<typeof monitorEventLoopDelay>;
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

function childCpuMetrics(): ChildCpuMetrics {
    const cpu = process.cpuUsage();
    const provenance = { collector: 'node-child-cpu-v1', scope: 'process' as const, unit: 'microseconds' };
    return {
        processCpuUserMicroseconds: availableMetric(cpu.user, provenance),
        processCpuSystemMicroseconds: availableMetric(cpu.system, provenance),
        processCpuTotalMicroseconds: availableMetric(cpu.user + cpu.system, provenance)
    };
}

function childMemoryMetrics(): ChildMemoryMetrics {
    const memory = process.memoryUsage();
    const provenance = { collector: 'node-child-memory-v1', scope: 'process' as const, unit: 'bytes' };
    return {
        residentSetBytes: availableMetric(memory.rss, provenance),
        heapUsedBytes: availableMetric(memory.heapUsed, { ...provenance, scope: 'thread' }),
        processMaximumResidentSetBytes: availableMetric(
            process.resourceUsage().maxRSS * bytesPerBinaryKilobyte,
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

function childRuntimeMetrics(observation: ChildRuntimeObservation): ChildRuntimeMetrics {
    const { histogram, utilization } = observation;
    return {
        eventLoopDelayMeanMicroseconds: childLoopDelay(histogram, histogram.mean),
        eventLoopDelayMaximumMicroseconds: childLoopDelay(histogram, histogram.max),
        eventLoopDelayPercentile95Microseconds: childLoopDelay(histogram, histogram.percentile(percentile95)),
        eventLoopUtilization: availableMetric(runtimePerformance.eventLoopUtilization(utilization).utilization, {
            collector: 'node-child-runtime-v1',
            scope: 'thread',
            unit: 'ratio'
        })
    };
}

export function observeNodeChild(): NodeChildObservation {
    const observation = {
        histogram: monitorEventLoopDelay({ samplePerIteration: true }),
        started: process.hrtime.bigint(),
        utilization: runtimePerformance.eventLoopUtilization()
    };
    observation.histogram.enable();
    return {
        snapshot() {
            return {
                version: 1,
                runtime: process.version,
                observationMicroseconds: Number(process.hrtime.bigint() - observation.started) /
                    nanosecondsPerMicrosecond,
                metrics: { ...childCpuMetrics(), ...childMemoryMetrics(), ...childRuntimeMetrics(observation) }
            };
        },
        dispose() {
            observation.histogram.disable();
        }
    };
}
