import { handleWorkerMessage } from '../run/worker-pool-task-events.ts';
import type { WorkerPoolRunRuntime } from '../run/worker-pool-runtime.ts';
import type { RunOrchestratorDependencies } from '../run/run-orchestrator-dependencies.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import { createCollectedPlan, createTaskRun, fakeWorkerRuntime } from './worker-pool-execution-state.ts';

type WorkerTaskOutputFixture = {
    readonly live: readonly string[];
    readonly artifacts: () => readonly RunArtifact[];
    readonly deliver: (stream: 'stderr' | 'stdout') => void;
};
function outputStream(
    stream: 'stderr' | 'stdout',
    record: (text: string) => void
): RunOrchestratorDependencies['liveOutput']['stdout'] {
    return {
        write(chunk) {
            record(`${stream}:${typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString()}`);
        }
    };
}
export function workerTaskOutput(capture: 'buffered' | 'live'): WorkerTaskOutputFixture {
    const original = fakeWorkerRuntime(createCollectedPlan());
    const live: string[] = [];
    const record = function (text: string): void {
        live.push(text);
    };
    const runtime: WorkerPoolRunRuntime = {
        ...original,
        resolvedRun: {
            ...original.resolvedRun,
            facts: { ...original.resolvedRun.facts, execution: { ...original.resolvedRun.facts.execution, capture } }
        },
        dependencies: {
            ...original.dependencies,
            liveOutput: { stdout: outputStream('stdout', record), stderr: outputStream('stderr', record) }
        }
    };
    const task = createTaskRun(runtime.runState);
    return {
        live,
        artifacts: task.state.artifacts,
        deliver(stream) {
            handleWorkerMessage(
                {
                    kind: 'output',
                    stream,
                    chunk: Buffer.from('worker output'),
                    capturedAtMicroseconds: 1
                },
                task,
                runtime
            );
        }
    };
}
