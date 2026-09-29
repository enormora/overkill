import { threadId } from 'node:worker_threads';
import { createOverkillClock, type OverkillClock } from '../clock/overkill-clock.ts';
import type {
    RunTimingSpan,
    RunTimingSpanKind,
    TimingSpanStatus
} from '../engine/run-timings.ts';
import type { WorkerPoolTask } from './worker-pool-protocol.ts';
import {
    createResourceLifecycleTiming,
    type ResourceLifecycleTiming
} from './resource-lifecycle-timing.ts';

export type WorkerTimingClock = OverkillClock;

type WorkerTimingSpanInput = {
    readonly completedAtMicroseconds: number;
    readonly kind: RunTimingSpanKind;
    readonly startedAtMicroseconds: number;
    readonly status: TimingSpanStatus;
    readonly task: WorkerPoolTask;
};

function workerProcessId(): string {
    return String(process.pid);
}

export function workerPoolWorkerId(): `${number}:${number}` {
    return `${process.pid}:${threadId}`;
}

export function createWorkerTimingClock(): WorkerTimingClock {
    const clock = createOverkillClock();

    return clock;
}

function workerId(task: WorkerPoolTask): string | null {
    return task.kind === 'collect' ? null : workerPoolWorkerId();
}

export function createWorkerResourceLifecycleTiming(
    task: WorkerPoolTask,
    clock: WorkerTimingClock
): ResourceLifecycleTiming {
    return createResourceLifecycleTiming({
        clock,
        processId: workerProcessId(),
        target: {
            emit(span) {
                task.port.postMessage({ kind: 'timing', span }, []);
            },
            kind: 'local'
        },
        workerId: workerId(task)
    });
}

export function postWorkerTimingSpan(input: WorkerTimingSpanInput): void {
    const span: RunTimingSpan = {
        durationMicroseconds: Math.max(0, Math.trunc(input.completedAtMicroseconds - input.startedAtMicroseconds)),
        kind: input.kind,
        label: null,
        processId: workerProcessId(),
        resource: null,
        startOffsetMicroseconds: null,
        status: input.status,
        workerId: input.task.kind === 'run' ? workerPoolWorkerId() : null
    };

    input.task.port.postMessage({ kind: 'timing', span }, []);
}

export async function measureWorkerSpan<Value>(
    task: WorkerPoolTask,
    wallClock: WorkerTimingClock,
    kind: RunTimingSpanKind,
    work: () => Promise<Value>
): Promise<Value> {
    const startedAtMicroseconds = wallClock.currentMonotonicMicroseconds;

    try {
        const value = await work();
        postWorkerTimingSpan({
            completedAtMicroseconds: wallClock.currentMonotonicMicroseconds,
            kind,
            startedAtMicroseconds,
            status: 'success',
            task
        });

        return value;
    } catch (error: unknown) {
        postWorkerTimingSpan({
            completedAtMicroseconds: wallClock.currentMonotonicMicroseconds,
            kind,
            startedAtMicroseconds,
            status: 'failure',
            task
        });
        throw error;
    }
}
