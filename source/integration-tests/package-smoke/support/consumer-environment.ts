import { delimiter, dirname } from 'node:path';
import { readProcessEnvironment } from '../../../run/node-host-readers.ts';

export function consumerEnvironment(directory: string): Readonly<Record<string, string>> {
    const hook = new URL('./consumer-isolation.ts', import.meta.url);
    hook.searchParams.set('root', directory);
    const inheritedPaths = (readProcessEnvironment(process).PATH ?? '').split(delimiter).filter(
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
