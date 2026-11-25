import { enableCompileCache } from 'node:module';
import { privateCacheDirectory } from '../private-cache-directory.ts';
import { readProcessEnvironment } from './node-host-readers.ts';

export async function enableAnalysisCompileCache(): Promise<void> {
    const environment = readProcessEnvironment(process);
    if (environment.NODE_DISABLE_COMPILE_CACHE === '1' || environment.NODE_V8_COVERAGE !== undefined) {
        return;
    }
    try {
        const directory = await privateCacheDirectory('overkill-analysis-compile-cache');
        if (directory !== null) {
            enableCompileCache(directory);
        }
    } catch {}
}
