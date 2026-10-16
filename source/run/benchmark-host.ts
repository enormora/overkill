import os from 'node:os';
import type { Clock } from '@enormora/clock';
import type { BenchmarkHostSnapshot, HostReading } from '../bench/benchmark-host-snapshot.ts';
import { availableMemoryPercent, hostLoadPerCpuPercent, readBenchmarkHostCapacity } from './benchmark-host-capacity.ts';
import { observeBenchmarkHostWindow } from './benchmark-host-observer.ts';
import { collectPlatformPressure } from './benchmark-host-platform.ts';
import { observeHost, unavailableHostReading } from './benchmark-host-reading.ts';
import type { BenchmarkHostObservationRequest } from './run-host-observations.ts';

const maximumObservationMilliseconds = 1000;
const probeTimeoutMilliseconds = 250;

function platformSignal(
    pressure: BenchmarkHostSnapshot['platformPressure'],
    key: string,
    source: string
): HostReading<number> {
    return pressure[key] ??
        unavailableHostReading(source, 'host', 'percent', 'Signal is unsupported on this platform.');
}

export async function collectBenchmarkHost(
    input: BenchmarkHostObservationRequest,
    clock: Clock
): Promise<BenchmarkHostSnapshot> {
    const startedDate = new Date(clock.currentUnixEpochMilliseconds);
    const startedAt = startedDate.toISOString();
    const started = clock.currentMonotonicMicroseconds;
    const signal = AbortSignal.timeout(Math.min(maximumObservationMilliseconds, input.timeoutMilliseconds));
    const platformPressure = await collectPlatformPressure(
        process.platform,
        AbortSignal.any([ signal, AbortSignal.timeout(probeTimeoutMilliseconds) ])
    );
    const observer = await observeBenchmarkHostWindow(signal);
    const capacity = readBenchmarkHostCapacity();
    return {
        version: 1,
        startedAt,
        durationMicroseconds: Number(clock.currentMonotonicMicroseconds - started),
        runtime: {
            processId: process.pid,
            nodeVersion: process.versions.node,
            v8Version: process.versions.v8,
            architecture: process.arch,
            operatingSystem: process.platform,
            operatingSystemRelease: observeHost('os.release()', 'host', 'release', os.release),
            nodeArguments: Array.from(process.execArgv)
        },
        capacity,
        signals: {
            cpuBusyPercent: observer.cpuBusy,
            hostLoadPerCpuPercent: hostLoadPerCpuPercent(capacity),
            availableMemoryPercent: availableMemoryPercent(capacity),
            linuxCpuStallPercent: platformSignal(platformPressure, 'linux.cpu.some.avg10', '/proc/pressure/cpu'),
            linuxMemoryStallPercent: platformSignal(
                platformPressure,
                'linux.memory.some.avg10',
                '/proc/pressure/memory'
            ),
            linuxIoStallPercent: platformSignal(platformPressure, 'linux.io.some.avg10', '/proc/pressure/io'),
            darwinCpuSpeedPercent: platformSignal(platformPressure, 'CPU_Speed_Limit', '/usr/bin/pmset -g therm'),
            darwinCpuSchedulerPercent: platformSignal(
                platformPressure,
                'CPU_Scheduler_Limit',
                '/usr/bin/pmset -g therm'
            )
        },
        platformPressure,
        observer: observer.metrics
    };
}
