import type { Clock } from '@enormora/clock';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import type { DebugAttempt } from './test-debug-recording.ts';

type DebugCheckpointsRequest = {
    readonly clock: Clock;
    readonly attempt: DebugAttempt;
    readonly report: () => Promise<void>;
    readonly failed: (error: unknown) => void;
};
type BackgroundTimer = { readonly unref: () => void; };
const checkpointIntervalMilliseconds = 50;
function isBackgroundTimer(value: unknown): value is BackgroundTimer {
    return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'unref') === 'function';
}
function startCheckpointTimer(clock: Clock, checkpoint: () => void): () => void {
    const timer = withRunnerInfrastructure(function schedule() {
        return clock.setInterval(checkpoint, checkpointIntervalMilliseconds);
    });
    if (isBackgroundTimer(timer)) {
        timer.unref();
    }
    return function stop() {
        clock.clearInterval(timer);
    };
}
export function startDebugCheckpoints(request: DebugCheckpointsRequest): () => Promise<void> {
    let pending: Promise<void> | null = null;
    async function deliver(): Promise<void> {
        try {
            await request.report();
        } catch (error: unknown) {
            request.failed(error);
        } finally {
            pending = null;
        }
    }
    function checkpoint(): void {
        if (pending === null && request.attempt.isOpen()) {
            pending = deliver();
        }
    }
    request.attempt.onCheckpoint(checkpoint);
    const stopTimer = startCheckpointTimer(request.clock, checkpoint);
    return async function stop() {
        request.attempt.close();
        stopTimer();
        await pending;
    };
}
