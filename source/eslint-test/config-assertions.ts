import type { TestScope } from '../packages/engine/engine.entry-point.ts';
import { observeRule, ruleCheck } from './rule-observation.ts';
import { propagateConfigControls } from './config-errors.ts';

type ConfigOperation<Result> = { readonly kind: 'failed'; } | { readonly kind: 'passed'; readonly value: Result; };

function completeConfigOperation<Result>(scope: TestScope, label: string, value: Result): ConfigOperation<Result> {
    scope.signal.throwIfAborted();
    if (value === null || typeof value !== 'object') {
        scope.assert(ruleCheck, label, { kind: 'passed' });
    }
    return { kind: 'passed', value };
}

export async function assertConfigOperation<Result>(
    scope: TestScope,
    label: string,
    run: () => Promise<Result>
): Promise<ConfigOperation<Result>> {
    try {
        scope.signal.throwIfAborted();
        const value = await run();
        return completeConfigOperation(scope, label, value);
    } catch (error) {
        propagateConfigControls(error, scope.signal);
        const observation = observeRule(function failed() {
            throw error;
        }, scope.signal);
        scope.assert(ruleCheck, label, observation);
        return { kind: 'failed' };
    }
}
