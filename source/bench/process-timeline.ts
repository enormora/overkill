import { AsyncLocalStorage } from 'node:async_hooks';
import { nanosecondsPerMicrosecond } from './measurement-units.ts';

export type ProcessCheckpoint = {
    readonly name: string;
    readonly startMicroseconds: number;
    readonly durationMicroseconds: number;
    readonly outcome: 'complete' | 'failed';
};
type ProcessTimeline = {
    readonly origin: bigint;
    readonly record: (checkpoint: ProcessCheckpoint) => void;
};
const processTimeline = new AsyncLocalStorage<ProcessTimeline>();

export async function withProcessTimeline<Value>(
    record: ProcessTimeline['record'] | null,
    operation: () => Promise<Value>
): Promise<Value> {
    return record === null
        ? await operation()
        : await processTimeline.run({ origin: process.hrtime.bigint(), record }, operation);
}

function recordCheckpoint(
    scope: ProcessTimeline,
    name: string,
    started: bigint,
    outcome: ProcessCheckpoint['outcome']
): void {
    scope.record({
        name,
        outcome,
        startMicroseconds: Number(started - scope.origin) / nanosecondsPerMicrosecond,
        durationMicroseconds: Number(process.hrtime.bigint() - started) / nanosecondsPerMicrosecond
    });
}

export async function processCheckpoint<Value>(name: string, operation: () => Promise<Value>): Promise<Value> {
    const scope = processTimeline.getStore();
    if (scope === undefined) {
        return await operation();
    }
    const started = process.hrtime.bigint();
    try {
        const value = await operation();
        recordCheckpoint(scope, name, started, 'complete');
        return value;
    } catch (error: unknown) {
        recordCheckpoint(scope, name, started, 'failed');
        throw error;
    }
}
