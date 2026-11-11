import type { RunnerError } from './run-result.ts';

export function familyRunnerError(cause: unknown): RunnerError {
    return {
        attributedTo: null,
        attributedToAttempt: null,
        cause,
        diagnostics: [],
        message: cause instanceof Error ? cause.message : 'Family execution failed.',
        subtype: 'runtime-state'
    };
}
