import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import type TypeScript from 'typescript';
import { isGeneratedTypeTestPath } from '../../generated-input-path.ts';
import { repairGeneratedImports, type ImportDiagnostic, type RepairedModule } from './generated-imports.ts';
import { validateMappings } from './generated-source.ts';
import type { GeneratedInputRequest, GeneratedModuleResult } from './generated-input-types.ts';

function fingerprint(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

export function parseProject(request: GeneratedInputRequest): TypeScript.ParsedCommandLine {
    const errors: TypeScript.Diagnostic[] = [];
    const project = request.compiler.getParsedCommandLineOfConfigFile(request.projectConfigPath, {}, {
        ...request.compiler.sys,
        onUnRecoverableConfigFileDiagnostic(diagnostic) {
            errors.push(diagnostic);
        }
    });
    if (project === undefined || errors.length > 0 || project.errors.length > 0) {
        throw new Error(`Cannot parse original project: ${request.projectConfigPath}`);
    }
    return project;
}

function moduleResults(
    repaired: readonly RepairedModule[],
    paths: ReadonlyMap<string, string>
): readonly GeneratedModuleResult[] {
    const diagnostics = new Map<string, ImportDiagnostic[]>(repaired.map(function entry(value) {
        return [ value.module.path, Array.from(value.diagnostics) ] as const;
    }));
    let changed = true;
    while (changed) {
        changed = false;
        for (const value of repaired) {
            const own = diagnostics.get(value.module.path);
            if (
                own?.length === 0 && value.dependencies.some(function ambiguous(path) {
                    return (diagnostics.get(path)?.length ?? 0) > 0;
                })
            ) {
                own.push({ path: value.module.path, ranges: [], message: 'Imports an ambiguous translated module.' });
                changed = true;
            }
        }
    }
    return repaired.map(function result(value): GeneratedModuleResult {
        const own = diagnostics.get(value.module.path) ?? [];
        if (own.length > 0) {
            return { kind: 'ambiguous', originalPath: value.module.path, diagnostics: own };
        }
        const path = paths.get(value.module.path);
        if (path === undefined) {
            throw new Error('Missing allocated generated path.');
        }
        return {
            kind: 'ready',
            path,
            provenance: {
                originalPath: value.module.path,
                generatedPath: path,
                originalFingerprint: fingerprint(value.module.originalText),
                generatedFingerprint: fingerprint(value.module.text),
                mappings: value.module.mappings,
                repairs: value.repairs,
                limitations: [
                    'Generated modules have distinct identity.',
                    'Transitive nominal references and package resolution may produce false verdicts.',
                    'Source-path-sensitive constructs may produce false passes or false failures.'
                ]
            }
        };
    });
}

function validateOriginalPath(path: string, paths: ReadonlyMap<string, string>): void {
    if (!isAbsolute(path) || path !== resolve(path) || paths.has(path) || isGeneratedTypeTestPath(path)) {
        throw new Error(`Invalid or duplicate original path: ${path}`);
    }
}
async function allocatePaths(request: GeneratedInputRequest): Promise<ReadonlyMap<string, string>> {
    const paths = new Map<string, string>();
    const token = randomUUID();
    for (const module of request.modules) {
        validateOriginalPath(module.path, paths);
        validateMappings(module);
        if (await readFile(module.path, 'utf8') !== module.originalText) {
            throw new Error(`Original source changed: ${module.path}`);
        }
        paths.set(module.path, join(dirname(module.path), `.overkill-type-test-${token}-${basename(module.path)}`));
    }
    return paths;
}
export async function planGeneratedModules(request: GeneratedInputRequest): Promise<{
    readonly paths: ReadonlyMap<string, string>;
    readonly repaired: readonly RepairedModule[];
    readonly modules: readonly GeneratedModuleResult[];
}> {
    const project = parseProject(request);
    const paths = await allocatePaths(request);
    const repaired = request.modules.map(function repair(module) {
        return repairGeneratedImports(request.compiler, project.options, module, paths);
    });
    return { paths, repaired, modules: moduleResults(repaired, paths) };
}
