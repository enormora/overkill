import type { CommandLineRunTestsRequest } from '../run/command-line.entry-point.ts';

type RunShard = CommandLineRunTestsRequest['runRequest']['shard'];

type RunShardText = {
    readonly index: string;
    readonly total: string;
};

const positiveDecimalPattern = /^[1-9]\d*$/u;
const shardPartCount = 2;

function isPositiveDecimal(value: string | undefined): value is string {
    return value !== undefined && positiveDecimalPattern.test(value);
}

function parseRunShardText(value: string): RunShardText {
    const [ index, total, extra ] = value.split('/');

    if (value.split('/').length !== shardPartCount || !isPositiveDecimal(index) || !isPositiveDecimal(total)) {
        throw new TypeError(`Run shard must use i/n syntax with positive integers: ${value}`);
    }

    if (extra !== undefined) {
        throw new TypeError(`Run shard must use i/n syntax with positive integers: ${value}`);
    }

    return { index, total };
}

function parsePositiveSafeInteger(label: string, value: string): number {
    const parsedValue = Number(value);

    if (!Number.isSafeInteger(parsedValue) || parsedValue <= 0) {
        throw new TypeError(`${label} must be a positive safe integer: ${value}`);
    }

    return parsedValue;
}

export function parseRunShard(value: string): RunShard {
    const { index: indexText, total: totalText } = parseRunShardText(value);
    const index = parsePositiveSafeInteger('Shard index', indexText);
    const total = parsePositiveSafeInteger('Shard total', totalText);

    if (index > total) {
        throw new TypeError(`Shard index must not exceed shard total: ${value}`);
    }

    return { index, total };
}
