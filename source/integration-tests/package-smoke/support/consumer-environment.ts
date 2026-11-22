import { dirname } from 'node:path';

export function consumerEnvironment(directory: string): Readonly<Record<string, string>> {
    const hook = new URL('./consumer-isolation.ts', import.meta.url);
    hook.searchParams.set('root', directory);
    return {
        PATH: dirname(process.execPath),
        NODE_OPTIONS: `--no-preserve-symlinks --no-preserve-symlinks-main --import=${hook.href}`
    };
}
