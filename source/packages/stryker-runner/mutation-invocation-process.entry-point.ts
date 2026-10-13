export const mutationInvocationProcessUrl = import.meta.url;
export const mutationInvocationProcessArgument = '--overkill-mutation-invocation';

export function readMutationInvocationEnvironment(): Readonly<Record<string, string | undefined>> {
    const excluded = new Set([
        'NODE_OPTIONS',
        'NODE_CONFIG',
        'NODE_CHANNEL_FD',
        'NODE_CHANNEL_SERIALIZATION_MODE',
        'NODE_UNIQUE_ID'
    ]);
    return Object.fromEntries(
        Object.entries(process.env).filter(function invocationVariable([ name ]) {
            return !excluded.has(name);
        })
    );
}

if (process.argv.includes(mutationInvocationProcessArgument)) {
    await import('./mutation-invocation-host.ts');
}
