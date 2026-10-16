import { readFile } from 'node:fs/promises';
import { z } from 'zod/v4';
import type { BenchmarkHostSnapshot } from '../bench/benchmark-host-snapshot.ts';
import { percentScale } from '../config/benchmark-host.ts';
import { hostNumber, unavailableHostReading } from './benchmark-host-reading.ts';
import { collectDarwinPressure } from './benchmark-host-darwin.ts';

type PlatformPressure = BenchmarkHostSnapshot['platformPressure'];
const maximumProbeBytes = 65_536;
const pressureFieldNameSchema = z.enum([ 'avg10', 'avg60', 'avg300', 'total' ]);
const pressureFieldSchema = z.tuple([
    pressureFieldNameSchema,
    z.string().regex(/^\d+(?:\.\d+)?$/u)
]);
const pressureLevelSchema = z.enum([ 'some', 'full' ]);
const pressureFieldsSchema = z.record(pressureFieldNameSchema, z.number());

function pressureField(field: string): readonly [string, number] {
    const [ name, encoded ] = pressureFieldSchema.parse(field.split('='));
    const range = name === 'total'
        ? z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
        : z.number().min(0).max(percentScale);
    return [ name, range.parse(Number(encoded)) ];
}

function pressureLine(line: string): readonly [string, Readonly<Record<string, number>>] {
    const [ level, ...fields ] = line.trim().split(/\s+/u);
    const entries = fields.map(pressureField);
    const names = new Set(entries.map(function name(entry) {
        return entry[0];
    }));
    if (names.size !== entries.length) {
        throw new TypeError('Duplicate PSI pressure field.');
    }
    return [ pressureLevelSchema.parse(level), pressureFieldsSchema.parse(Object.fromEntries(entries)) ];
}

export function parseLinuxPressure(text: string, source: string): PlatformPressure {
    const lines = text.trim().split('\n').map(pressureLine);
    const levels = new Map(lines);
    if (!levels.has('some') || levels.size !== lines.length) {
        throw new TypeError('Missing or duplicate PSI pressure level.');
    }
    return Object.fromEntries(lines.flatMap(function pressureReadings([ level, fields ]) {
        return Object.entries(fields).map(function pressureReading([ name, value ]) {
            return [
                `${level}.${name}`,
                hostNumber(source, 'host', name === 'total' ? 'microseconds' : 'percent', function nativeValue() {
                    return value;
                })
            ];
        });
    }));
}

async function readPressureFile(source: string, signal: AbortSignal): Promise<PlatformPressure> {
    const text = await readFile(source, { encoding: 'utf8', signal });
    if (Buffer.byteLength(text) > maximumProbeBytes) {
        throw new TypeError('PSI probe exceeded its output limit.');
    }
    return parseLinuxPressure(text, source);
}

async function linuxPressure(resource: string, signal: AbortSignal): Promise<PlatformPressure> {
    const source = `/proc/pressure/${resource}`;
    try {
        return await readPressureFile(source, signal);
    } catch (error: unknown) {
        return {
            'some.avg10': unavailableHostReading(
                source,
                'host',
                'percent',
                error instanceof Error
                    ? error.message
                    : String(error)
            )
        };
    }
}

export async function collectPlatformPressure(platform: string, signal: AbortSignal): Promise<PlatformPressure> {
    if (platform === 'darwin') {
        return await collectDarwinPressure(signal);
    }
    if (platform !== 'linux') {
        return {};
    }
    const readings = await Promise.all([ 'cpu', 'memory', 'io' ].map(async function pressure(resource) {
        const values = await linuxPressure(resource, signal);
        return Object.entries(values).map(function nameReading([ key, value ]) {
            return [ `linux.${resource}.${key}`, value ] as const;
        });
    }));
    return Object.fromEntries(readings.flat());
}
