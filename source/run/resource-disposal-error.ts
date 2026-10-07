import type { RunnerError } from '../engine/run-result.ts';
import { AttachmentOperationError } from './attachment-failure.ts';

export function resourceDisposalErrors(error: unknown): readonly RunnerError[] {
    if (error instanceof AggregateError) {
        const causes: readonly unknown[] = error.errors;
        return causes.flatMap(resourceDisposalErrors);
    }
    if (error instanceof AttachmentOperationError) {
        const failure = error.take();
        return failure === null ? [] : [ failure ];
    }
    return [ {
        attributedToAttempt: null,
        attributedTo: null,
        attributedToWork: null,
        cause: error,
        diagnostics: [],
        message: 'Resource disposal failed.',
        subtype: 'runtime-policy'
    } ];
}
