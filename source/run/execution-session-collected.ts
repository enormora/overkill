import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { InvocationDeadlineExceededError, isInvocationCancellation } from '../invocation-budget.ts';
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

type CollectedSessionRun = Pick<CollectedRun, 'plan' | 'run'>;
export type CollectedSessionRuntime = {
    readonly collect: () => Promise<CollectedSessionRun>;
    readonly lifecycle: typeof withExecutionLifecycle;
};
type CollectedExecution = {
    readonly options: RunExecutionSessionOptions;
    readonly runtime: CollectedSessionRuntime;
    readonly collection: StoredValue<Promise<CollectedSessionRun> | null>;
    readonly artifacts: StoredValue<Extract<RunExecutionReply, { readonly kind: 'result'; }>['result']['artifacts']>;
};

async function executeCollectedInvocation(
    execution: CollectedExecution,
    lifecycle: RunExecutionLifecycle
): Promise<RunExecutionReply> {
    const collecting = execution.collection.read() ??
        execution.runtime.collect();
    execution.collection.write(collecting);
    const collected = await collecting;
    const selection = await lifecycle.select(collected.plan);
    await lifecycle.beforeCases();
    const { maintenanceDiagnostics, context, ...result } = await collected.run({ selection });
    execution.artifacts.write(result.artifacts);
    return { kind: 'result', result, data: lifecycle.snapshot(), deadlineExceeded: false };
}

export function createCollectedSession(
    options: RunExecutionSessionOptions,
    runtime: CollectedSessionRuntime
): ExecutionSessionEnvironment {
    const collection = createStoredValue<Promise<CollectedSessionRun> | null>(null);
    return {
        lifetime: 'reused',
        async execute(call) {
            const reply = createStoredValue<RunExecutionReply['data']>(null);
            const artifacts = createStoredValue<
                Extract<RunExecutionReply, { readonly kind: 'result'; }>['result']['artifacts']
            >([]);
            try {
                return await runtime.lifecycle(
                    call.transport,
                    options.command.policy.moduleBoundary,
                    call,
                    async function (lifecycle) {
                        try {
                            return await executeCollectedInvocation(
                                { options, runtime, collection, artifacts },
                                lifecycle
                            );
                        } finally {
                            reply.write(lifecycle.snapshot());
                            await call.checkpoint(reply.read());
                        }
                    }
                );
            } catch (error: unknown) {
                if (
                    call.signal.reason instanceof InvocationDeadlineExceededError &&
                    isInvocationCancellation(error, call.signal)
                ) {
                    return { kind: 'timeout', artifacts: artifacts.read(), data: reply.read() };
                }
                return {
                    kind: 'failure',
                    artifacts: artifacts.read(),
                    failure: runExecutionFailure(error),
                    data: reply.read()
                };
            }
        }
    };
}

export function createCollectedExecutionSession(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies
): ExecutionSessionEnvironment {
    return createCollectedSession(options, {
        async collect() {
            return await collectExecutionSession(options, dependencies);
        },
        lifecycle: withExecutionLifecycle
    });
}
