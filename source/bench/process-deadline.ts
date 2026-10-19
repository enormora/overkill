import { setTimeout as wait } from 'node:timers/promises';

export class ProcessDeadlineError extends Error {
    public constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = 'ProcessDeadlineError';
    }
}

async function expiredProcessDeadline(milliseconds: number, message: string, signal: AbortSignal): Promise<never> {
    await wait(milliseconds, undefined, { signal });
    throw new ProcessDeadlineError(message, {});
}

export async function withinProcessDeadline<Value>(
    pending: Promise<Value>,
    milliseconds: number,
    message: string
): Promise<Value> {
    const timeout = new AbortController();
    try {
        return await Promise.race([ pending, expiredProcessDeadline(milliseconds, message, timeout.signal) ]);
    } finally {
        timeout.abort();
    }
}
