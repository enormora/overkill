export function consumerEnvironment(environment: Readonly<NodeJS.ProcessEnv>, directory: string): NodeJS.ProcessEnv {
    const hook = new URL('./consumer-isolation.ts', import.meta.url);
    const options = [ environment.NODE_OPTIONS ?? '', `--import=${hook.href}` ];
    return {
        ...environment,
        NODE_OPTIONS: options.join(' ').trim(),
        OVERKILL_PACKAGE_SMOKE_ROOT: directory
    };
}
