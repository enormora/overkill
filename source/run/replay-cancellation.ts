import { currentReplaySignal } from './replay-context.ts';
import { stopWorkerPoolTasks } from './worker-pool-task-events.ts';
import type { WorkerPoolRunRuntime } from './worker-pool-runtime.ts';
import type { WorkerPoolWorkDispatcher } from './worker-pool-dispatch-state.ts';

type ReplayCancellation = { readonly runtime: WorkerPoolRunRuntime; readonly dispatcher: WorkerPoolWorkDispatcher; };
function cancelPlacement(context: ReplayCancellation): void {
    context.runtime.terminalFailure.write(true);
    context.runtime.runState.recordRunnerError({
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null,
        cause: null,
        diagnostics: [],
        message: 'Replay was cancelled.',
        subtype: 'crash'
    });
    context.dispatcher.clear();
    stopWorkerPoolTasks(context.runtime, null, 'run-stopped', 'Replay was cancelled.');
}
export async function withReplayCancellation(context: ReplayCancellation, execute: () => Promise<void>): Promise<void> {
    const signal = currentReplaySignal();
    const cancel = function cancelReplay(): void {
        cancelPlacement(context);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted === true) {
        cancel();
    }
    try {
        await execute();
    } finally {
        signal?.removeEventListener('abort', cancel);
    }
}
