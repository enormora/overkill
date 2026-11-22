import { delimiter, dirname } from 'node:path';
import { z } from 'zod/v4';

export function consumerEnvironment(directory: string): Readonly<Record<string, string>> {
    const hook = new URL('./consumer-isolation.ts', import.meta.url);
    hook.searchParams.set('root', directory);
    const environment = z.object({ PATH: z.string().default('') }).parse(Reflect.get(process, 'env'));
    const inheritedPaths = environment.PATH.split(delimiter).filter(
        function outsideDependencyBins(executableDirectory) {
            return !executableDirectory.split(/[\\/]/u).includes('node_modules');
        }
    );
    return {
        PATH: [ dirname(process.execPath), ...inheritedPaths ].join(delimiter),
        NODE_OPTIONS:
            `--disable-warning=PERM0004 --no-preserve-symlinks --no-preserve-symlinks-main --import=${hook.href}`
    };
}
