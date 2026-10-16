import type { BenchmarkHostSnapshot, HostReading } from '../bench/benchmark-host-snapshot.ts';

function reading<Value>(value: Value, unit: string): HostReading<Value> {
    return { availability: 'available', value, source: 'fixture', scope: 'host', unit };
}

const values = {
    cpuCount: 8,
    parallelism: 2,
    memory: 1000,
    freeMemory: 200,
    availableMemory: 100,
    constraint: 500,
    oneMinuteLoad: 4,
    fiveMinuteLoad: 3,
    fifteenMinuteLoad: 2,
    cpuBusy: 25,
    loadPerCpu: 50,
    availablePercent: 20,
    cpuStall: 5,
    memoryStall: 1,
    ioStall: 2,
    fullCapacity: 100
};

export function benchmarkHostSnapshot(): BenchmarkHostSnapshot {
    return {
        version: 1,
        startedAt: '2026-10-15T10:00:00.000Z',
        durationMicroseconds: 250_000,
        runtime: {
            processId: 1,
            nodeVersion: '26.9.0',
            v8Version: 'fixture',
            architecture: 'x64',
            operatingSystem: 'linux',
            operatingSystemRelease: reading('fixture', 'release'),
            nodeArguments: []
        },
        capacity: {
            availableParallelism: reading(values.parallelism, 'count'),
            logicalCpuCount: reading(values.cpuCount, 'count'),
            cpuModels: reading([ 'fixture-cpu' ], 'model'),
            totalMemoryBytes: reading(values.memory, 'bytes'),
            freeMemoryBytes: reading(values.freeMemory, 'bytes'),
            availableMemoryBytes: reading(values.availableMemory, 'bytes'),
            constrainedMemoryBytes: reading(values.constraint, 'bytes'),
            loadAverage: reading([ values.oneMinuteLoad, values.fiveMinuteLoad, values.fifteenMinuteLoad ], 'load')
        },
        signals: {
            cpuBusyPercent: reading(values.cpuBusy, 'percent'),
            hostLoadPerCpuPercent: reading(values.loadPerCpu, 'percent'),
            availableMemoryPercent: reading(values.availablePercent, 'percent'),
            linuxCpuStallPercent: reading(values.cpuStall, 'percent'),
            linuxMemoryStallPercent: reading(values.memoryStall, 'percent'),
            linuxIoStallPercent: reading(values.ioStall, 'percent'),
            darwinCpuSpeedPercent: reading(values.fullCapacity, 'percent'),
            darwinCpuSchedulerPercent: reading(values.fullCapacity, 'percent')
        },
        platformPressure: {},
        observer: {}
    };
}
