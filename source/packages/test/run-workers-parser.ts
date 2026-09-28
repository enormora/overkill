import type { Type } from 'cmd-ts';
import type { CommandLineRunTestsRequest } from '../run/command-line.entry-point.ts';

type RunWorkers = CommandLineRunTestsRequest['runRequest']['workers'];

const positiveDecimalPattern = /^[1-9]\d*$/u;

function parseRunWorkers(value: string): RunWorkers {
    const workers = Number(value);

    if (!positiveDecimalPattern.test(value) || !Number.isSafeInteger(workers)) {
        throw new TypeError(`Worker count must be a positive safe integer: ${value}`);
    }

    return workers;
}

export const runWorkersType: Type<string, RunWorkers> = {
    displayName: 'n',
    async from(value) {
        await Promise.resolve();

        return parseRunWorkers(value);
    }
};
