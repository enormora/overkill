import { InvocationDeadlineExceededError, isInvocationCancellation } from '../invocation-budget.ts';
import { createRunOperations } from './run-operations.ts';
import { withExecutionSession } from './execution-session-context.ts';
import { createExecutionHostOwnership } from './execution-session-ownership.ts';
import {
    createExecutionDataObservation,
    observedReply,
    observeExecutionMessage,
    type ExecutionDataObservation
} from './execution-session-observation.ts';
import type { ExecutionSessionCall, ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';
import { runExecutionFailure } from './execution-failure.ts';

type RunExecutionReply = Awaited<ReturnType<ExecutionSessionEnvironment['execute']>>;
function observedDependencies(
    dependencies: RunOrchestratorDependencies,
    observation: ExecutionDataObservation,
    start: RunOrchestratorDependencies['startSupervisedChild']
): RunOrchestratorDependencies {
    return {
        ...dependencies,
        async startSupervisedChild(input) {
            const child = await start(input);
            child.on('message', function (message: unknown) {
                observeExecutionMessage(observation, message);
            });
            return child;
        }
    };
}
export async function runSupervisedExecutionSession(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies,
    call: ExecutionSessionCall
): Promise<RunExecutionReply> {
    const observation = createExecutionDataObservation();
    const ownership = createExecutionHostOwnership(dependencies.startSupervisedChild, call.signal);
    const operations = createRunOperations(observedDependencies(dependencies, observation, ownership.start), 'test');
    const signal = AbortSignal.any([ call.signal, observation.invalid.signal ]);
    try {
        const result = await withExecutionSession(
            call.transport,
            async function () {
                return await operations.run(options.command, { signal, timing: null });
            }
        );
        return observedReply(result, call, observation);
    } catch (error: unknown) {
        return signal.reason instanceof InvocationDeadlineExceededError && isInvocationCancellation(error, signal)
            ? { kind: 'timeout', data: observation.data.read() }
            : { kind: 'failure', failure: runExecutionFailure(error), data: observation.data.read() };
    } finally {
        await ownership.dispose();
    }
}
