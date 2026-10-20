import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { metricReadingSchema } from '../packages/run/benchmark-calibration.entry-point.ts';
import { unavailableMetric } from './metric-reading.ts';

export const nodeProbeMaximumReportBytes = 65_536;
export const nodeProbeIdentitySchema = z.strictObject({ token: z.string(), pid: z.number().int().positive() });

const childMetricDeclarations = [
    { name: 'processCpuUserMicroseconds', collector: 'node-child-cpu-v1', scope: 'process', unit: 'microseconds' },
    { name: 'processCpuSystemMicroseconds', collector: 'node-child-cpu-v1', scope: 'process', unit: 'microseconds' },
    { name: 'processCpuTotalMicroseconds', collector: 'node-child-cpu-v1', scope: 'process', unit: 'microseconds' },
    { name: 'residentSetBytes', collector: 'node-child-memory-v1', scope: 'process', unit: 'bytes' },
    { name: 'heapUsedBytes', collector: 'node-child-memory-v1', scope: 'thread', unit: 'bytes' },
    { name: 'processMaximumResidentSetBytes', collector: 'node-child-memory-v1', scope: 'process', unit: 'bytes' },
    {
        name: 'eventLoopDelayMeanMicroseconds',
        collector: 'node-child-runtime-v1',
        scope: 'runtime',
        unit: 'microseconds'
    },
    {
        name: 'eventLoopDelayMaximumMicroseconds',
        collector: 'node-child-runtime-v1',
        scope: 'runtime',
        unit: 'microseconds'
    },
    {
        name: 'eventLoopDelayPercentile95Microseconds',
        collector: 'node-child-runtime-v1',
        scope: 'runtime',
        unit: 'microseconds'
    },
    { name: 'eventLoopUtilization', collector: 'node-child-runtime-v1', scope: 'thread', unit: 'ratio' }
] as const;

export const nodeChildReadingsSchema = z.strictObject({
    processCpuUserMicroseconds: metricReadingSchema,
    processCpuSystemMicroseconds: metricReadingSchema,
    processCpuTotalMicroseconds: metricReadingSchema,
    residentSetBytes: metricReadingSchema,
    heapUsedBytes: metricReadingSchema,
    processMaximumResidentSetBytes: metricReadingSchema,
    eventLoopDelayMeanMicroseconds: metricReadingSchema,
    eventLoopDelayMaximumMicroseconds: metricReadingSchema,
    eventLoopDelayPercentile95Microseconds: metricReadingSchema,
    eventLoopUtilization: metricReadingSchema
});
export const nodeProbeReportSchema = z.strictObject({
    version: z.literal(1),
    runtime: z.string(),
    observationMicroseconds: z.number().nonnegative(),
    metrics: nodeChildReadingsSchema
});
export type NodeProbeReport = ReadonlyDeep<z.infer<typeof nodeProbeReportSchema>>;

export function unavailableChildMetrics(reason: string): NodeProbeReport['metrics'] {
    return nodeChildReadingsSchema.parse(
        Object.fromEntries(childMetricDeclarations.map(function missingChildReading(metric) {
            return [ metric.name, unavailableMetric(reason, metric) ];
        }))
    );
}
