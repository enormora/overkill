import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

export const mutationPolicyProcessUrl = import.meta.url;
export const mutationPolicyProcessArgument = '--overkill-mutation-policy-resolver';

const resolverExcludedVariables = new Set([
    'NODE_OPTIONS',
    'NODE_CONFIG',
    'NODE_CHANNEL_FD',
    'NODE_UNIQUE_ID',
    INSTRUMENTER_CONSTANTS.ACTIVE_MUTANT_ENV_VARIABLE
]);

export function readMutationPolicyEnvironment(): Readonly<Record<string, string | undefined>> {
    return Object.fromEntries(
        Object.entries(process.env).filter(function resolverVariable([ name ]) {
            return !resolverExcludedVariables.has(name);
        })
    );
}

if (process.argv.includes(mutationPolicyProcessArgument)) {
    await import('./mutation-policy-resolver.ts');
}
