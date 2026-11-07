import { isGeneratedTypeTestPath } from '../run/run.entry-point.ts';
import { createGeneratedFileOwnership, type GeneratedFileOwnership } from './generated-file-ownership.ts';
import { planGeneratedModules, parseProject } from './generated-module-plan.ts';
import type { RepairedModule } from './generated-imports.ts';
import { mapSourceRange } from './generated-source.ts';
import type { GeneratedInputRequest, GeneratedInputBatch, GeneratedModuleResult } from './generated-input-types.ts';

export type {
    GeneratedInputRequest,
    GeneratedInputBatch,
    GeneratedModuleResult,
    GeneratedProvenance
} from './generated-input-types.ts';
export { mapSourceRange } from './generated-source.ts';
export type { SourceMapping, SourceRange, TranslatedModule } from './generated-source.ts';
export { isGeneratedTypeTestPath } from '../run/run.entry-point.ts';
async function writeReadyInputs(
    modules: readonly GeneratedModuleResult[],
    repaired: readonly RepairedModule[],
    owned: GeneratedFileOwnership
): Promise<void> {
    const ready = modules.filter(function readyModule(result) {
        return result.kind === 'ready';
    });
    for (const result of ready) {
        const source = repaired.find(function matches(value) {
            return value.module.path === result.provenance.originalPath;
        });
        if (source === undefined) {
            throw new Error('Missing generated source.');
        }
        await owned.write(result.path, source.module.text);
    }
}
async function prepareInputs(
    request: GeneratedInputRequest,
    owned: GeneratedFileOwnership
): Promise<GeneratedInputBatch> {
    const { paths, repaired, modules } = await planGeneratedModules(request);
    await writeReadyInputs(modules, repaired, owned);
    if (parseProject(request).fileNames.some(isGeneratedTypeTestPath)) {
        throw new Error(
            'Original project discovers generated inputs; exclude .overkill-type-test-* files before checking.'
        );
    }
    return {
        modules,
        mapRange(path, range, direction) {
            const source = repaired.find(function matches(value) {
                return (direction === 'original' ? value.module.path : paths.get(value.module.path)) === path;
            });
            return source === undefined ? [ range ] : mapSourceRange(source.module.mappings, range, direction);
        }
    };
}
async function usePreparedInputs<Result>(
    request: GeneratedInputRequest,
    useInputs: (inputs: GeneratedInputBatch) => Promise<Result>,
    owned: GeneratedFileOwnership
): Promise<Result> {
    try {
        return await useInputs(await prepareInputs(request, owned));
    } catch (error: unknown) {
        try {
            await owned.cleanup();
        } catch (cleanupError: unknown) {
            throw new AggregateError([ error, cleanupError ], 'Generated input operation and cleanup failed.', {
                cause: cleanupError
            });
        }
        throw error;
    }
}

export async function withGeneratedInputs<Result>(
    request: GeneratedInputRequest,
    useInputs: (inputs: GeneratedInputBatch) => Promise<Result>
): Promise<Result> {
    const owned = createGeneratedFileOwnership();
    const result = await usePreparedInputs(request, useInputs, owned);
    await owned.cleanup();
    return result;
}
