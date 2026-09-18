import type { CommandLineRunTestsRequest } from '../run/command-line.entry-point.ts';

type RunSeed = CommandLineRunTestsRequest['runRequest']['seed'];

const unsignedDecimalPattern = /^(?:0|[1-9]\d*)$/u;

export function parseRunSeed(value: string): RunSeed {
    if (!unsignedDecimalPattern.test(value)) {
        throw new TypeError(`Run seed must be a nonnegative base-10 integer: ${value}`);
    }

    return { value: BigInt(value) };
}
