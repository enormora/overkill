import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { InvocationDeadlineExceededError } from '../invocation-budget.ts';
import { executionTermination } from '../execution-termination.ts';
import { envelopeMessage } from './child-process-protocol.ts';
import { supervisedChildMessageSchema } from './supervised-protocol-schema.ts';
import { supervisedChildCorrelationId, type SupervisedChildMessage } from './supervised-protocol.ts';
import { runExecutionFailure } from './execution-failure.ts';
import type { RunExecutionReply } from './execution-session-types.ts';
import type { ExecutionSessionCall } from './execution-session-runtime-types.ts';

type RunResult = Extract<RunExecutionReply, { readonly kind: 'result'; }>['result'];

export type ExecutionDataObservation = {
    readonly data: StoredValue<RunExecutionReply['data']>;
    readonly delivered: StoredValue<boolean>;
    readonly failure: StoredValue<Error | null>;
    readonly invalid: AbortController;
    readonly result: StoredValue<RunResult | null>;
};
function storeExecutionData(
    observation: ExecutionDataObservation,
    message: Extract<SupervisedChildMessage, { readonly kind: 'execution-checkpoint' | 'execution-data'; }>
): void {
    if (observation.delivered.read()) {
        throw new Error('Duplicate execution lifecycle data.');
    }
    observation.delivered.write(message.kind === 'execution-data');
    observation.data.write(message.data);
}
function readExecutionData(observation: ExecutionDataObservation, message: unknown): void {
    const decoded = envelopeMessage(message, supervisedChildCorrelationId, supervisedChildMessageSchema);
    if (decoded === null) {
        return;
    }
    if (decoded.kind === 'result') {
        observation.result.write(decoded.result);
    } else if (decoded.kind === 'execution-data' || decoded.kind === 'execution-checkpoint') {
        storeExecutionData(observation, decoded);
    }
}
export function observeExecutionMessage(observation: ExecutionDataObservation, message: unknown): void {
    try {
        readExecutionData(observation, message);
    } catch (error: unknown) {
        observation.failure.write(
            error instanceof Error ? error : new Error('Invalid execution lifecycle data.', { cause: error })
        );
        observation.invalid.abort();
    }
}
function missingDataReply(
    result: RunResult,
    call: ExecutionSessionCall,
    observation: ExecutionDataObservation
): RunExecutionReply {
    const data = observation.data.read();
    if (
        call.signal.aborted && result.runnerErrors.every(function (error) {
            return error.subtype === 'crash';
        })
    ) {
        return { kind: 'failure', artifacts: result.artifacts, failure: runExecutionFailure(call.signal.reason), data };
    }
    const errors = result
        .runnerErrors
        .map(function (error) {
            return error.message;
        })
        .join('\n');
    return {
        kind: 'failure',
        artifacts: result.artifacts,
        failure: runExecutionFailure(new Error(`Execution lifecycle data was not delivered. ${errors}`)),
        data
    };
}
function interruptedExecutionReply(
    result: RunResult,
    call: ExecutionSessionCall,
    observation: ExecutionDataObservation
): RunExecutionReply {
    const timedOut = result.runnerErrors.some(function hardTimeout(error) {
        return error.subtype === 'crash' && executionTermination(error.cause) === 'hard-timeout';
    }) || call.signal.reason instanceof InvocationDeadlineExceededError;
    if (!timedOut) {
        return missingDataReply(result, call, observation);
    }
    const onlyInterruption = result.runnerErrors.every(function timeoutError(error) {
        return error.subtype === 'crash' && executionTermination(error.cause) !== null;
    });
    return onlyInterruption
        ? { kind: 'timeout', artifacts: result.artifacts, data: observation.data.read() }
        : { kind: 'result', result, data: observation.data.read(), deadlineExceeded: true };
}
export function observedReply(
    result: RunResult,
    call: ExecutionSessionCall,
    observation: ExecutionDataObservation
): RunExecutionReply {
    const failure = observation.failure.read();
    if (failure !== null) {
        return {
            kind: 'failure',
            artifacts: result.artifacts,
            failure: runExecutionFailure(failure),
            data: observation.data.read()
        };
    }
    if (!observation.delivered.read()) {
        return interruptedExecutionReply(result, call, observation);
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
export function createExecutionDataObservation(): ExecutionDataObservation {
    return {
        data: createStoredValue<RunExecutionReply['data']>(null),
        delivered: createStoredValue(false),
        failure: createStoredValue<Error | null>(null),
        invalid: new AbortController(),
        result: createStoredValue<RunResult | null>(null)
    };
}
