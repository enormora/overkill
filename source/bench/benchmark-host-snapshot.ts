import { z } from 'zod/v4';
import type { ReadonlyDeep } from 'type-fest';
import { benchmarkHostLimitsSchema } from '../config/benchmark-host.ts';

function hostReadingSchema<Value>(value: Readonly<z.ZodType<Value>>): z.ZodType<HostReading<Value>> {
    const provenance = {
        source: z.string().min(1),
        scope: z.enum([ 'host', 'process', 'runtime', 'thread' ]),
        unit: z.string().min(1)
    };
    return z.discriminatedUnion('availability', [
        z.strictObject({ ...provenance, availability: z.literal('available'), value }),
        z.strictObject({ ...provenance, availability: z.literal('unavailable'), reason: z.string().min(1) })
    ]);
}

const numericReading = hostReadingSchema(z.number());
type HostReadingProvenance = {
    readonly source: string;
    readonly scope: 'host' | 'process' | 'runtime' | 'thread';
    readonly unit: string;
};
type HostReadingStates<Value> = {
    readonly available: { readonly availability: 'available'; readonly value: Value; };
    readonly unavailable: { readonly availability: 'unavailable'; readonly reason: string; };
};
export type HostReading<Value> = HostReadingProvenance & HostReadingStates<Value>[keyof HostReadingStates<Value>];

export const benchmarkHostSnapshotSchema = z.strictObject({
    version: z.literal(1),
    startedAt: z.iso.datetime(),
    durationMicroseconds: z.number().nonnegative(),
    runtime: z.strictObject({
        processId: z.number().int().positive(),
        nodeVersion: z.string(),
        v8Version: z.string(),
        architecture: z.string(),
        operatingSystem: z.string(),
        operatingSystemRelease: hostReadingSchema(z.string()),
        nodeArguments: z.array(z.string())
    }),
    capacity: z.strictObject({
        availableParallelism: numericReading,
        logicalCpuCount: numericReading,
        cpuModels: hostReadingSchema(z.array(z.string())),
        totalMemoryBytes: numericReading,
        freeMemoryBytes: numericReading,
        availableMemoryBytes: numericReading,
        constrainedMemoryBytes: numericReading,
        loadAverage: hostReadingSchema(z.tuple([ z.number(), z.number(), z.number() ]))
    }),
    signals: z.strictObject({
        cpuBusyPercent: numericReading,
        hostLoadPerCpuPercent: numericReading,
        availableMemoryPercent: numericReading,
        linuxCpuStallPercent: numericReading,
        linuxMemoryStallPercent: numericReading,
        linuxIoStallPercent: numericReading,
        darwinCpuSpeedPercent: numericReading,
        darwinCpuSchedulerPercent: numericReading
    }),
    platformPressure: z.record(z.string(), numericReading),
    observer: z.record(z.string(), numericReading)
});

const checkFields = {
    limit: benchmarkHostLimitsSchema.unwrap().keyof(),
    configuredPercent: z.number().nonnegative()
};
export const benchmarkHostAssessmentSchema = z.strictObject({
    snapshot: benchmarkHostSnapshotSchema,
    limits: benchmarkHostLimitsSchema,
    checks: z.array(z.discriminatedUnion('status', [
        z.strictObject({ ...checkFields, status: z.enum([ 'passed', 'violated' ]), observedPercent: z.number() }),
        z.strictObject({ ...checkFields, status: z.literal('unavailable'), reason: z.string().min(1) })
    ]))
});

export type BenchmarkHostSnapshot = ReadonlyDeep<z.infer<typeof benchmarkHostSnapshotSchema>>;
export type BenchmarkHostAssessment = ReadonlyDeep<z.infer<typeof benchmarkHostAssessmentSchema>>;
export type BenchmarkHostCheck = BenchmarkHostAssessment['checks'][number];
