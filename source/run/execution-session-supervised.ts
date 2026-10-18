import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { envelopeMessage } from './child-process-protocol.ts';
import { supervisedChildMessageSchema } from './supervised-protocol-schema.ts';
import { supervisedChildCorrelationId } from './supervised-protocol.ts';
import { createRunOperations } from './run-operations.ts';
import { withExecutionSession } from './execution-session-context.ts';
import { runExecutionFailure } from './execution-failure.ts';
import type { ExecutionSessionCall, ExecutionSessionEnvironment } from './execution-session-runtime-types.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunExecutionSessionOptions } from './run-types.ts';

type RunExecutionReply = Awaited<ReturnType<ExecutionSessionEnvironment['execute']>>;

type RunResult = Extract<RunExecutionReply, { readonly kind: 'result'; }>['result'];

type ExecutionDataObservation = {
    readonly data: StoredValue<RunExecutionReply['data']>;
    readonly delivered: StoredValue<boolean>;
    readonly failure: StoredValue<Error | null>;
    readonly invalid: AbortController;
    readonly result: StoredValue<RunResult | null>;
};
function readExecutionData(observation: ExecutionDataObservation, message: unknown): void {
    const decoded = envelopeMessage(message, supervisedChildCorrelationId, supervisedChildMessageSchema);
    if (decoded?.kind === 'result') {
        observation.result.write(decoded.result);
    }
    if (decoded?.kind !== 'execution-data') {
        return;
    }
    if (observation.delivered.read()) {
        throw new Error('Duplicate execution lifecycle data.');
    }
    observation.delivered.write(true);
    observation.data.write(decoded.data);
}
function observeExecutionMessage(observation: ExecutionDataObservation, message: unknown): void {
    try {
        readExecutionData(observation, message);
    } catch (error: unknown) {
        observation.failure.write(
            error instanceof Error ? error : new Error('Invalid execution lifecycle data.', { cause: error })
        );
        observation.invalid.abort();
    }
}
function observedDependencies(
    dependencies: RunOrchestratorDependencies,
    observation: ExecutionDataObservation
): RunOrchestratorDependencies {
    return {
        ...dependencies,
        async startSupervisedChild(input) {
            const child = await dependencies.startSupervisedChild(input);
            child.on('message', function (message: unknown) {
                observeExecutionMessage(observation, message);
            });
            return child;
        }
    };
}
function missingDataReply(result: RunResult, call: ExecutionSessionCall): RunExecutionReply {
    if (
        call.signal.aborted && result.runnerErrors.every(function (error) {
            return error.subtype === 'crash';
        })
    ) {
        return { kind: 'failure', failure: runExecutionFailure(call.signal.reason), data: null };
    }
    const errors = result
        .runnerErrors
        .map(function (error) {
            return error.message;
        })
        .join('\n');
    return {
        kind: 'failure',
        failure: runExecutionFailure(new Error(`Execution lifecycle data was not delivered. ${errors}`)),
        data: null
    };
}
function observedReply(
    result: RunResult,
    call: ExecutionSessionCall,
    observation: ExecutionDataObservation
): RunExecutionReply {
    const failure = observation.failure.read();
    if (failure !== null) {
        return { kind: 'failure', failure: runExecutionFailure(failure), data: observation.data.read() };
    }
    if (!observation.delivered.read()) {
        return missingDataReply(result, call);
    }
    const completed = observation.result.read();
    const selected = completed === null ? result : {
        ...result,
        bySuite: completed.bySuite,
        planStatus: completed.planStatus,
        summary: { ...result.summary, planned: completed.summary.planned }
    };
    return { kind: 'result', result: selected, data: observation.data.read(), deadlineExceeded: false };
}
export async function runSupervisedExecutionSession(
    options: RunExecutionSessionOptions,
    dependencies: RunOrchestratorDependencies,
    call: ExecutionSessionCall
): Promise<RunExecutionReply> {
    const observation: ExecutionDataObservation = {
        data: createStoredValue<RunExecutionReply['data']>(null),
        delivered: createStoredValue(false),
        failure: createStoredValue<Error | null>(null),
        invalid: new AbortController(),
        result: createStoredValue<RunResult | null>(null)
    };
    const operations = createRunOperations(observedDependencies(dependencies, observation), 'test');
    const signal = AbortSignal.any([ call.signal, observation.invalid.signal ]);
    const result = await withExecutionSession(
        call.transport,
        async function () {
            return await operations.run(options.command, { signal, timing: null });
        }
    );
    return observedReply(result, call, observation);
}
