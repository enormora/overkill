import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { dirname, join } from 'node:path';
import type TypeScript from 'typescript';
import { parseProject } from './generated-module-plan.ts';
import type { GeneratedInputRequest } from './generated-input-types.ts';
import { createGeneratedFileOwnership, type GeneratedFileOwnership } from './generated-file-ownership.ts';

function references(
    project: TypeScript.ParsedCommandLine
): readonly { readonly path: string; readonly circular: boolean | undefined; }[] {
    return project.projectReferences?.map(function reference(value) {
        return { path: value.path, circular: value.circular };
    }) ?? [];
}
function verifyProject(
    original: TypeScript.ParsedCommandLine,
    derived: TypeScript.ParsedCommandLine,
    files: readonly string[]
): void {
    const { configFilePath: originalIdentity, ...originalOptions } = original.options;
    const { configFilePath: derivedIdentity, ...derivedOptions } = derived.options;
    const missing = files.some(function missingFile(file) {
        return !derived.fileNames.includes(file);
    });
    if (
        originalIdentity === derivedIdentity || missing || !isDeepStrictEqual(originalOptions, derivedOptions) ||
        !isDeepStrictEqual(references(original), references(derived))
    ) {
        throw new Error('Derived checker project does not preserve original configuration.');
    }
}
async function createCheckerProject(
    request: GeneratedInputRequest,
    paths: readonly string[],
    owned: GeneratedFileOwnership
): Promise<string> {
    const original = parseProject(request);
    const path = join(dirname(request.projectConfigPath), `.overkill-type-test-${randomUUID()}.tsconfig.json`);
    const files = Array.from(new Set([ ...original.fileNames, ...paths ]));
    await owned.write(
        path,
        JSON.stringify({ extends: request.projectConfigPath, files, include: [], references: references(original) })
    );
    verifyProject(original, parseProject({ ...request, projectConfigPath: path }), files);
    return path;
}
async function useProject<Result>(
    request: GeneratedInputRequest,
    paths: readonly string[],
    use: (path: string) => Promise<Result>,
    owned: GeneratedFileOwnership
): Promise<Result> {
    try {
        return await use(await createCheckerProject(request, paths, owned));
    } catch (error: unknown) {
        try {
            await owned.cleanup();
        } catch (cleanupError: unknown) {
            throw new AggregateError([ error, cleanupError ], 'Checker project cleanup failed.', {
                cause: cleanupError
            });
        }
        throw error;
    }
}
export async function withCheckerProject<Result>(
    request: GeneratedInputRequest,
    paths: readonly string[],
    use: (path: string) => Promise<Result>
): Promise<Result> {
    const owned = createGeneratedFileOwnership();
    const result = await useProject(request, paths, use, owned);
    await owned.cleanup();
    return result;
}
