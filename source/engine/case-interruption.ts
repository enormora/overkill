import { createStoredValue } from '../stored-value.ts';
import { debugBodyStarted, debugBodyCompleted } from './test-debug-recording.ts';
import type { PerTestResult, RunnerError } from './run-result.ts';

export type ExecutedCase = {
    readonly result: PerTestResult;
    readonly runnerErrors: readonly RunnerError[];
    readonly durationMicroseconds: number;
};

type CaseBodyCompletion<Value> = {
    readonly kind: 'interrupted';
    readonly result: ExecutedCase;
} | {
    readonly kind: 'returned';
    readonly value: Value;
} | {
    readonly kind: 'threw';
    readonly error: unknown;
};

export type CaseInterruption = {
    readonly result: () => ExecutedCase | null;
    readonly run: <Value>(operation: () => Promise<Value>) => Promise<CaseBodyCompletion<Value>>;
};

async function completeBody<Value>(operation: () => Promise<Value>): Promise<CaseBodyCompletion<Value>> {
    try {
        return { kind: 'returned', value: await operation() };
    } catch (error: unknown) {
        return { kind: 'threw', error };
    }
}

export function createCaseInterruption(completion: Promise<ExecutedCase> | null): CaseInterruption {
    const terminal = createStoredValue<ExecutedCase | null>(null);
    async function retainInterruption(pending: Promise<ExecutedCase>): Promise<CaseBodyCompletion<never>> {
        const result = await pending;
        terminal.write(result);
        return { kind: 'interrupted', result };
    }
    const interrupted = completion === null ? null : retainInterruption(completion);
    return {
        result: terminal.read,
        async run(operation) {
            debugBodyStarted();
            const body = completeBody(operation);
            const result = interrupted === null ? await body : await Promise.race([ body, interrupted ]);
            debugBodyCompleted(result);
            return result;
        }
    };
}
