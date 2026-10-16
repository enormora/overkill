import { execFile } from 'node:child_process';
import { z } from 'zod/v4';
import type { BenchmarkHostSnapshot, HostReading } from '../bench/benchmark-host-snapshot.ts';
import { percentScale } from '../config/benchmark-host.ts';
import { hostNumber, unavailableHostReading } from './benchmark-host-reading.ts';

type PlatformPressure = BenchmarkHostSnapshot['platformPressure'];
const maximumProbeBytes = 65_536;
const probeTimeoutMilliseconds = 250;
const normalPressureCode = 1;
const warningPressureCode = 2;
const criticalPressureCode = 4;
const memoryPressureCodeSchema = z.union([
    z.literal(normalPressureCode),
    z.literal(warningPressureCode),
    z.literal(criticalPressureCode)
]);
const thermalSource = '/usr/bin/pmset -g therm';
const memorySource = '/usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level';

export function parseDarwinCpuLimits(text: string): PlatformPressure {
    return Object.fromEntries([ 'CPU_Speed_Limit', 'CPU_Scheduler_Limit' ].map(function cpuLimit(name) {
        const matches = Array.from(text.matchAll(new RegExp(`^\\s*${name}\\s*=\\s*(\\d+)\\s*$`, 'gmu')));
        const encoded = matches.length === 1 ? matches[0]?.[1] : undefined;
        const reading = encoded !== undefined && Number(encoded) <= percentScale
            ? hostNumber(thermalSource, 'host', 'percent', function limit() {
                return Number(encoded);
            })
            : unavailableHostReading<number>(thermalSource, 'host', 'percent', `${name} is missing or invalid.`);
        return [ name, reading ];
    }));
}

async function readProbe(executable: string, args: readonly string[], signal: AbortSignal): Promise<string> {
    return await new Promise(function executeProbe(resolve, reject) {
        execFile(executable, args, {
            signal,
            timeout: probeTimeoutMilliseconds,
            maxBuffer: maximumProbeBytes,
            encoding: 'utf8'
        }, function completed(error: Error | null, stdout: string) {
            if (error === null) {
                resolve(stdout);
            } else {
                reject(error);
            }
        });
    });
}

async function thermalPressure(signal: AbortSignal): Promise<PlatformPressure> {
    try {
        return parseDarwinCpuLimits(await readProbe('/usr/bin/pmset', [ '-g', 'therm' ], signal));
    } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : String(error);
        return Object.fromEntries([ 'CPU_Speed_Limit', 'CPU_Scheduler_Limit' ].map(function unavailable(name) {
            return [ name, unavailableHostReading<number>(thermalSource, 'host', 'percent', reason) ];
        }));
    }
}

async function readMemoryPressure(signal: AbortSignal): Promise<HostReading<number>> {
    const output = await readProbe('/usr/sbin/sysctl', [ '-n', 'kern.memorystatus_vm_pressure_level' ], signal);
    const encoded = z.string().regex(/^\d+$/u).parse(output.trim());
    const value = memoryPressureCodeSchema.parse(Number(encoded));
    return hostNumber(memorySource, 'host', 'native-code', function pressureCode() {
        return value;
    });
}

async function memoryPressure(signal: AbortSignal): Promise<HostReading<number>> {
    try {
        return await readMemoryPressure(signal);
    } catch (error: unknown) {
        return unavailableHostReading(
            memorySource,
            'host',
            'native-code',
            error instanceof Error ? error.message : String(error)
        );
    }
}

export async function collectDarwinPressure(signal: AbortSignal): Promise<PlatformPressure> {
    const [ thermal, memory ] = await Promise.all([ thermalPressure(signal), memoryPressure(signal) ]);
    return { ...thermal, darwinMemoryPressureCode: memory };
}
