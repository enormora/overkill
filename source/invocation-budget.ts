import type { Clock } from '@enormora/clock';

export class InvocationDeadlineExceededError extends Error {
    public constructor() {
        super('Invocation deadline exceeded.');
        this.name = 'InvocationDeadlineExceededError';
    }
}

export type InvocationBudget = {
    readonly signal: AbortSignal;
    readonly remainingMilliseconds: () => number;
    readonly expired: () => boolean;
    readonly dispose: () => void;
};
const microsecondsPerMillisecond = 1000;

function isAbortError(error: unknown, reason: unknown): boolean {
    return error instanceof Error && error.name === 'AbortError' && Reflect.get(error, 'code') === 'ABORT_ERR' &&
        error.cause === reason;
}

export function isInvocationCancellation(error: unknown, signal: AbortSignal): boolean {
    return signal.aborted && (error === signal.reason || isAbortError(error, signal.reason));
}

export function createInvocationBudget(
    timeoutMilliseconds: number,
    signal: Readonly<AbortSignal> | null,
    clock: Pick<Clock, 'clearTimeout' | 'currentMonotonicMicroseconds' | 'setTimeout'>
): InvocationBudget {
    const started = clock.currentMonotonicMicroseconds;
    const controller = new AbortController();
    const remainingMilliseconds = function (): number {
        return timeoutMilliseconds - Number(clock.currentMonotonicMicroseconds - started) / microsecondsPerMillisecond;
    };
    const timer = clock.setTimeout(function expireInvocation() {
        controller.abort(new InvocationDeadlineExceededError());
    }, Math.max(0, timeoutMilliseconds));
    return {
        signal: signal === null ? controller.signal : AbortSignal.any([ signal, controller.signal ]),
        remainingMilliseconds,
        expired() {
            return controller.signal.aborted || remainingMilliseconds() <= 0;
        },
        dispose() {
            clock.clearTimeout(timer);
        }
    };
}
