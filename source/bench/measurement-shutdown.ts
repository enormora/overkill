import { createClock, type Clock } from '@enormora/clock';
import { microsecondsPerMillisecond } from './measurement-units.ts';

const measurementShutdownMilliseconds = 2000;
export type MeasurementShutdown = {
    readonly signal: AbortSignal;
    readonly perform: (operation: () => void) => void;
    readonly run: <Value>(operation: () => Promise<Value> | Value) => Promise<Value>;
    readonly check: () => void;
    readonly close: () => void;
};
export async function awaitMeasurement<Value>(operation: Promise<Value>, signal: AbortSignal): Promise<Value> {
    const interrupted = Promise.withResolvers<never>();
    function abort(): void {
        interrupted.reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
        abort();
    }
    try {
        return await Promise.race([ operation, interrupted.promise ]);
    } finally {
        interrupted.reject(new Error('Measurement operation settled.'));
        signal.removeEventListener('abort', abort);
    }
}

export function createMeasurementDeadline(clock: Clock, milliseconds: number): MeasurementShutdown {
    const controller = new AbortController();
    const expires = clock.currentMonotonicMicroseconds + BigInt(milliseconds * microsecondsPerMillisecond);
    const expire = function expireMeasurement(): void {
        controller.abort(new Error('Measurement shutdown deadline exceeded.'));
    };
    const timer = clock.setTimeout(expire, milliseconds);
    const check = function checkDeadline(): void {
        if (clock.currentMonotonicMicroseconds >= expires) {
            expire();
        }
        controller.signal.throwIfAborted();
    };
    return {
        signal: controller.signal,
        check,
        perform(operation) {
            operation();
            check();
        },
        async run(operation) {
            const value = await awaitMeasurement(Promise.resolve(operation()), controller.signal);
            check();
            return value;
        },
        close() {
            clock.clearTimeout(timer);
            controller.abort(new Error('Measurement lifetime closed.'));
        }
    };
}
export function createMeasurementShutdown(): MeasurementShutdown {
    return createMeasurementDeadline(createClock(), measurementShutdownMilliseconds);
}
