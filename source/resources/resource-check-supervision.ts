import { createClock, type Clock } from '@enormora/clock';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import type { Awaitable } from './resource-definition-shape.ts';

const microsecondsPerMillisecond = 1000;
type ObservationDeadline<Value> = {
    readonly signal: AbortSignal;
    readonly completion: Promise<Value>;
    readonly dispose: () => void;
    readonly abort: (error: Error) => void;
};
function observationDeadline<Value>(
    parent: AbortSignal,
    milliseconds: number,
    clock: Clock
): ObservationDeadline<Value> {
    const interrupted = Promise.withResolvers<Value>();
    const controller = new AbortController();
    const signal = AbortSignal.any([ parent, controller.signal ]);
    function abortObservation(): void {
        interrupted.reject(signal.reason);
    }
    const timer = withRunnerInfrastructure(function scheduleObservation() {
        return clock.setTimeout(function expireObservation() {
            controller.abort(new Error('Resource observation deadline exceeded.'));
        }, Math.max(0, milliseconds));
    });
    signal.addEventListener('abort', abortObservation, { once: true });
    if (milliseconds <= 0 || signal.aborted) {
        controller.abort(new Error('Resource observation deadline exceeded.'));
        abortObservation();
    }
    return {
        signal,
        completion: interrupted.promise,
        abort(error) {
            controller.abort(error);
        },
        dispose() {
            interrupted.reject(new Error('Observation settled.'));
            clock.clearTimeout(timer);
            signal.removeEventListener('abort', abortObservation);
        }
    };
}
function assertObservationDeadline(deadline: ObservationDeadline<unknown>, elapsed: number, budget: number): void {
    if (elapsed >= budget) {
        const error = new Error('Resource observation deadline exceeded.');
        deadline.abort(error);
        throw error;
    }
}
export async function superviseResourceObservation<Value>(
    operation: (signal: AbortSignal) => Awaitable<Value>,
    parent: AbortSignal,
    milliseconds: number,
    clock: Clock
): Promise<Value> {
    const started = Number(clock.currentMonotonicMicroseconds);
    const deadline = observationDeadline<Value>(parent, milliseconds, clock);
    async function run(): Promise<Value> {
        return await operation(deadline.signal);
    }
    try {
        const result = await Promise.race([ run(), deadline.completion ]);
        assertObservationDeadline(
            deadline,
            Number(clock.currentMonotonicMicroseconds) - started,
            milliseconds * microsecondsPerMillisecond
        );
        return result;
    } finally {
        deadline.dispose();
    }
}

export type ResourceCheckSupervision = {
    readonly now: () => number;
    readonly run: <Value>(
        operation: (signal: AbortSignal) => Awaitable<Value>,
        parent: AbortSignal,
        milliseconds: number
    ) => Promise<Value>;
};
export function createResourceCheckSupervision(): ResourceCheckSupervision {
    const clock = createClock();
    return {
        now() {
            return Number(clock.currentMonotonicMicroseconds) / microsecondsPerMillisecond;
        },
        async run(operation, parent, milliseconds) {
            return await superviseResourceObservation(operation, parent, milliseconds, clock);
        }
    };
}
