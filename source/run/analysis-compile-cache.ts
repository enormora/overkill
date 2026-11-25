import { privateCacheDirectory } from '../private-cache-directory.ts';

export async function analysisCompileEnvironment(
    analysis: boolean,
    environment: Record<string, string>
): Promise<Record<string, string>> {
    if (
        !analysis || environment.NODE_COMPILE_CACHE !== undefined ||
        environment.NODE_DISABLE_COMPILE_CACHE === '1' || environment.NODE_V8_COVERAGE !== undefined
    ) {
        return environment;
    }
    const directory = await privateCacheDirectory('overkill-analysis-compile-cache').catch(function unavailable() {
        return null;
    });

    return directory === null ? environment : { ...environment, NODE_COMPILE_CACHE: directory };
}
