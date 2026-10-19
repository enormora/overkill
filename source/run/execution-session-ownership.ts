import { kill, type SupervisedChildProcess } from './supervised-child-process.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

type ExecutionHostOwnership = {
    readonly start: RunOrchestratorDependencies['startSupervisedChild'];
    readonly dispose: () => Promise<void>;
};

export function createExecutionHostOwnership(
    start: RunOrchestratorDependencies['startSupervisedChild'],
    signal: Readonly<AbortSignal>
): ExecutionHostOwnership {
    const children = new Map<SupervisedChildProcess, Promise<void>>();
    return {
        async start(input) {
            const child = await start(input);
            children.set(
                child,
                new Promise<void>(function observeClose(resolve) {
                    child.on('close', resolve);
                })
            );
            if (signal.aborted) {
                kill(child);
            }
            return child;
        },
        async dispose() {
            for (const child of children.keys()) {
                kill(child);
            }
            await Promise.all(children.values());
        }
    };
}
