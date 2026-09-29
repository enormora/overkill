import type { OverkillClock } from '../clock/overkill-clock.ts';
import type {
    RunTimingSpan,
    TimingSpanStatus
} from '../engine/run-timings.ts';
import type { ResourceScope } from '../resources/resources.ts';
import { isResourceStartupTimeoutError } from './resource-lifecycle-startup-budget.ts';
import type { RunTimingSpanObservation } from './run-timing-collection.ts';

export type ResourceLifecycleTimingOperation = {
    readonly phase: 'acquire' | 'dispose';
    readonly resource: {
        readonly name: string;
        readonly scope: ResourceScope;
    };
    readonly signal: AbortSignal;
};

export type ResourceLifecycleTiming = {
    readonly measure: <Value>(
        operation: ResourceLifecycleTimingOperation,
        work: () => Promise<Value>
    ) => Promise<Value>;
};

type ResourceLifecycleTimingTarget = {
    readonly kind: 'local';
    readonly emit: (span: RunTimingSpan) => void;
} | {
    readonly kind: 'parent';
    readonly record: (observation: RunTimingSpanObservation) => void;
};

export type ResourceLifecycleTimingOptions = {
    readonly clock: OverkillClock;
    readonly processId: string;
    readonly target: ResourceLifecycleTimingTarget;
    readonly workerId: string | null;
};

type CompletedResourceLifecycleTiming = {
    readonly completedAtMicroseconds: number;
    readonly operation: ResourceLifecycleTimingOperation;
    readonly startedAtMicroseconds: number;
    readonly status: TimingSpanStatus;
};

function timingKind(phase: ResourceLifecycleTimingOperation['phase']): RunTimingSpan['kind'] {
    return phase === 'acquire' ? 'resource.acquire' : 'resource.dispose';
}

function failedTimingStatus(
    error: unknown,
    operation: ResourceLifecycleTimingOperation
): TimingSpanStatus {
    if (isResourceStartupTimeoutError(error)) {
        return 'timeout';
    }

    return operation.signal.aborted ? 'cancelled' : 'failure';
}

function nonNegativeMicroseconds(value: number): number {
    return Math.max(0, Math.trunc(value));
}

function writeResourceTiming(
    options: ResourceLifecycleTimingOptions,
    completed: CompletedResourceLifecycleTiming
): void {
    const metadata = {
        label: null,
        processId: options.processId,
        resource: completed.operation.resource,
        workerId: options.workerId
    };

    if (options.target.kind === 'parent') {
        options.target.record({
            completedAtMicroseconds: completed.completedAtMicroseconds,
            kind: timingKind(completed.operation.phase),
            metadata,
            startedAtMicroseconds: completed.startedAtMicroseconds,
            status: completed.status
        });
    } else {
        options.target.emit({
            durationMicroseconds: nonNegativeMicroseconds(
                completed.completedAtMicroseconds - completed.startedAtMicroseconds
            ),
            kind: timingKind(completed.operation.phase),
            ...metadata,
            startOffsetMicroseconds: null,
            startTimeUnixMicroseconds: options.clock.monotonicTimeOriginUnixMicroseconds +
                completed.startedAtMicroseconds,
            status: completed.status
        });
    }
}

function recordResourceTiming(
    options: ResourceLifecycleTimingOptions,
    completed: CompletedResourceLifecycleTiming
): void {
    try {
        writeResourceTiming(options, completed);
    } catch {
    }
}

function currentTime(clock: OverkillClock): number | null {
    try {
        return clock.currentMonotonicMicroseconds;
    } catch {
        return null;
    }
}

function finishResourceTiming(
    options: ResourceLifecycleTimingOptions,
    operation: ResourceLifecycleTimingOperation,
    startedAtMicroseconds: number | null,
    status: TimingSpanStatus
): void {
    const completedAtMicroseconds = currentTime(options.clock);

    if (startedAtMicroseconds !== null && completedAtMicroseconds !== null) {
        recordResourceTiming(options, {
            completedAtMicroseconds,
            operation,
            startedAtMicroseconds,
            status
        });
    }
}

async function measureResourceLifecycle<Value>(
    options: ResourceLifecycleTimingOptions,
    operation: ResourceLifecycleTimingOperation,
    work: () => Promise<Value>
): Promise<Value> {
    const startedAtMicroseconds = currentTime(options.clock);

    try {
        const value = await work();

        finishResourceTiming(options, operation, startedAtMicroseconds, 'success');

        return value;
    } catch (error: unknown) {
        finishResourceTiming(options, operation, startedAtMicroseconds, failedTimingStatus(error, operation));
        throw error;
    }
}

export function createResourceLifecycleTiming(
    options: ResourceLifecycleTimingOptions
): ResourceLifecycleTiming {
    return {
        async measure<Value>(
            operation: ResourceLifecycleTimingOperation,
            work: () => Promise<Value>
        ): Promise<Value> {
            return await measureResourceLifecycle(options, operation, work);
        }
    };
}
