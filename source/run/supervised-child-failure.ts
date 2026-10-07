import type { SupervisedChildProcess } from './supervised-child-process.ts';
import { crashError } from './supervised-run-resource-policy.ts';
import type { SupervisedRunState } from './supervised-run-state.ts';

export function recordChildProtocolFailure(
    state: SupervisedRunState,
    reason: string,
    observedAtMicroseconds: number,
    restricted: boolean
): void {
    const activeAttempts = Array.from(state.activeCases.values(), function affectedAttempt(active) {
        return { attempt: active.attempt, case: active.id, work: active.workId };
    });

    state.recordRunnerError({
        attributedTo: null,
        attributedToAttempt: null,
        attributedToWork: null,
        cause: { activeAttempts, capability: 'child-process', reason, strictness: 'observed' },
        diagnostics: [ { label: 'strictness', value: 'observed' } ],
        message: reason,
        subtype: restricted ? 'runtime-policy' : 'crash'
    });
    state.recordTerminalActiveCases('crashed', observedAtMicroseconds);
}

export function recordPrematureChildExit(
    child: SupervisedChildProcess,
    state: SupervisedRunState,
    observedAtMicroseconds: number
): void {
    const code = String(child.exitCode);
    const signal = String(child.signalCode);

    state.recordRunnerError({
        ...crashError(
            state,
            `Supervised child terminated without successful protocol completion (code: ${code}, signal: ${signal}).`
        ),
        diagnostics: [ { label: 'exit-code', value: code }, { label: 'signal', value: signal } ]
    });
    state.recordTerminalActiveCases('crashed', observedAtMicroseconds);
}
