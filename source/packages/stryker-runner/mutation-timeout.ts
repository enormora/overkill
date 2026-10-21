import { type RunExecutionReply, type RunnerError, executionTermination } from '../run/run.entry-point.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;

export function isTimeoutInterruption(error: RunnerError): boolean {
    return error.subtype === 'crash' && executionTermination(error.cause) !== null;
}

export function isInterruptedExecution(reply: ResultReply): boolean {
    return reply.result.runnerErrors.some(function knownTimeout(error) {
        return isTimeoutInterruption(error) &&
            (reply.deadlineExceeded || executionTermination(error.cause) === 'hard-timeout');
    });
}
