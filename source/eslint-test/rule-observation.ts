import { defineCompositeAssertion } from '../packages/assert/assert.entry-point.ts';
import { isTestControlError } from '../packages/engine/engine.entry-point.ts';

type RuleObservation = { readonly kind: 'failed'; readonly error: unknown; } | { readonly kind: 'passed'; };

function permissionDenied(error: unknown): boolean {
    return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ERR_ACCESS_DENIED';
}

function propagateControl(error: unknown, signal: AbortSignal): void {
    signal.throwIfAborted();
    if (isTestControlError(error)) {
        throw error;
    }
    if (permissionDenied(error)) {
        throw error;
    }
}

export function observeRule(run: () => void, signal: AbortSignal): RuleObservation {
    signal.throwIfAborted();
    try {
        run();
        signal.throwIfAborted();
        return { kind: 'passed' };
    } catch (error) {
        propagateControl(error, signal);
        return { kind: 'failed', error };
    }
}

export const ruleCheck = defineCompositeAssertion({
    name: 'eslintRuleCheck',
    assert(check, label: string, observation: RuleObservation) {
        return check.fromThrowable(label, function observedRuleCheck() {
            if (observation.kind === 'failed') {
                throw observation.error;
            }
        });
    }
});
