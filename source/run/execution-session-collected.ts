import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { initializeRun } from './initialized-run.ts';
import { withExecutionLifecycle } from './execution-session-lifecycle.ts';
import { runExecutionFailure } from './execution-failure.ts';
import type { CollectedRun, RunExecutionSessionOptions, RunExecutionLifecycle } from './run-types.ts';
import type { RunExecutionReply } from './execution-session-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';

async function collectExecutionSession(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): Promise<CollectedRun> {
    const initialized = await initializeRun(options.command, dependencies);
    return await initialized.collect();
}

type CollectedExecution = {
    readonly options: RunExecutionSessionOptions;
    readonly dependencies: RunOrchestratorDependencies;
    readonly collection: StoredValue<Promise<CollectedRun> | null>;
};

async function executeCollectedInvocation(
    execution: CollectedExecution,
    lifecycle: RunExecutionLifecycle
): Promise<RunExecutionReply> {
    const collecting = execution.collection.read() ??
        collectExecutionSession(execution.options, execution.dependencies);
    execution.collection.write(collecting);
    const collected = await collecting;
    const selection = await lifecycle.select(collected.plan);
    await lifecycle.beforeCases();
    const result = await collected.run({ selection });
    return { kind: 'result', result, data: lifecycle.snapshot(), deadlineExceeded: false };
}

export function createCollectedExecutionSession(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): ExecutionSessionEnvironment {
    const collection = createStoredValue<Promise<CollectedRun> | null>(null);
    return {
        lifetime: 'reused',
        async execute(call) {
            const reply = createStoredValue<RunExecutionReply['data']>(null);
            try {
                return await withExecutionLifecycle(
                    call.transport,
                    options.command.policy.moduleBoundary,
                    async function (lifecycle) {
                        try {
                            return await executeCollectedInvocation({ options, dependencies, collection }, lifecycle);
                        } finally {
                            reply.write(lifecycle.snapshot());
                        }
                    }
                );
            } catch (error: unknown) {
                return { kind: 'failure', failure: runExecutionFailure(error), data: reply.read() };
            }
        }
    };
}
