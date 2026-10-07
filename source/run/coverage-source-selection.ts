import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CoverageReport, V8CoverageEntry } from 'monocart-coverage-reports';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { prepareLoadedCoverageSources } from './coverage-loaded-sources.ts';
import { isPathInside } from './path-containment.ts';
import { readNativeCoverageBatches, type CoverageNativeBatch } from './coverage-native-data.ts';
import {
    inspectCoverageSource,
    isSupportedCoverageSource,
    isTypeScriptCoverageSource,
    nativeTypeScriptCoverageSource,
    transformCoverageSource
} from './coverage-runtime-source.ts';
import type { RunCoverageSourcePolicy } from './run-types.ts';

export type CoverageSourceScope = RunCoverageSourcePolicy & {
    readonly excludedFiles: ReadonlySet<string>;
};
type CoverageSourceRequest = {
    readonly projectRoot: string;
    readonly rawDataDirectory: string;
    readonly sourceScope: CoverageSourceScope;
};
type CoverageReportOptions = NonNullable<ConstructorParameters<typeof CoverageReport>[0]>;
type CoverageAllOptions = NonNullable<CoverageReportOptions['all']>;
type AllFileEntry = {
    readonly source: string;
    readonly url: string;
};

function sourceFilePath(sourcePath: string, projectRoot: string): string {
    return path.resolve(projectRoot, sourcePath);
}

function includedProjectFile(
    filePath: string,
    projectRoot: string,
    excludedFiles: ReadonlySet<string>
): boolean {
    const resolvedPath = path.resolve(filePath);

    return isPathInside(projectRoot, resolvedPath) &&
        !resolvedPath.split(path.sep).includes('node_modules') &&
        !excludedFiles.has(resolvedPath);
}

function matchesSourcePatterns(
    filePath: string,
    projectRoot: string,
    include: NonEmptyReadonlyArray<string>,
    exclude: readonly string[]
): boolean {
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).join('/');

    return include.some(function matchesInclude(pattern) {
        return path.matchesGlob(relativePath, pattern);
    }) && exclude.every(function matchesExclude(pattern) {
        return !path.matchesGlob(relativePath, pattern);
    });
}

function includedSourceFile(filePath: string, request: CoverageSourceRequest): boolean {
    if (!includedProjectFile(filePath, request.projectRoot, request.sourceScope.excludedFiles)) {
        return false;
    }

    if (request.sourceScope.mode === 'all') {
        return matchesSourcePatterns(
            filePath,
            request.projectRoot,
            request.sourceScope.include,
            request.sourceScope.exclude
        );
    }

    return request.sourceScope.exclude.every(function matchesExclude(pattern) {
        const relativePath = path.relative(request.projectRoot, filePath).split(path.sep).join('/');

        return !path.matchesGlob(relativePath, pattern);
    });
}

async function isRuntimeSourceFile(filePath: string, request: CoverageSourceRequest): Promise<boolean> {
    if (!isSupportedCoverageSource(filePath) || !includedSourceFile(filePath, request)) {
        return false;
    }

    if (!isTypeScriptCoverageSource(filePath)) {
        return true;
    }

    return inspectCoverageSource(await readFile(filePath, 'utf8'), filePath).hasRuntime;
}

async function allRuntimeFiles(
    request: CoverageSourceRequest,
    sourceScope: Extract<CoverageSourceScope, { readonly mode: 'all'; }>
): Promise<ReadonlySet<string>> {
    const runtimeFiles = new Set<string>();
    const matchedFiles = glob(sourceScope.include, {
        cwd: request.projectRoot,
        exclude: sourceScope.exclude
    });

    for await (const relativePath of matchedFiles) {
        const filePath = path.resolve(request.projectRoot, relativePath);

        if (await isRuntimeSourceFile(filePath, request)) {
            runtimeFiles.add(filePath);
        }
    }

    return runtimeFiles;
}

function allFilesOptions(request: CoverageSourceRequest, runtimeFiles: ReadonlySet<string>): CoverageAllOptions | null {
    const { sourceScope } = request;

    if (sourceScope.mode === 'loaded') {
        return null;
    }

    return {
        dir: request.projectRoot,
        filter(filePath: string) {
            const resolvedPath = path.resolve(filePath);

            return runtimeFiles.has(resolvedPath);
        },
        async transformer(entry: AllFileEntry) {
            if (isTypeScriptCoverageSource(entry.url)) {
                Object.assign(entry, transformCoverageSource(entry.source, entry.url));
            }
        }
    };
}

export async function prepareCoverageSources(request: CoverageSourceRequest): Promise<{
    readonly all: CoverageAllOptions | null;
    readonly batches: readonly CoverageNativeBatch[];
    readonly entryIncluded: (entry: V8CoverageEntry) => boolean;
    readonly sourceIncluded: (sourcePath: string) => boolean;
    readonly onEntry: (entry: V8CoverageEntry) => Promise<void>;
    readonly sourcePath: (sourcePath: string, info: Readonly<Record<string, unknown>>) => string;
}> {
    const batches = await readNativeCoverageBatches(request.rawDataDirectory);
    const loaded = await prepareLoadedCoverageSources({
        batches,
        excludedFiles: request.sourceScope.excludedFiles,
        includeSource(filePath) {
            return includedSourceFile(filePath, request);
        },
        projectRoot: request.projectRoot
    });
    const resolvedRequest = {
        ...request,
        sourceScope: { ...request.sourceScope, excludedFiles: loaded.excludedFiles }
    };
    const runtimeFiles = resolvedRequest.sourceScope.mode === 'all'
        ? await allRuntimeFiles(resolvedRequest, resolvedRequest.sourceScope)
        : new Set<string>();
    const all = allFilesOptions(request, runtimeFiles);

    return {
        all,
        batches,
        entryIncluded(entry) {
            return loaded.entries.has(entry.url);
        },
        async onEntry(entry) {
            const map = loaded.maps.get(entry.url);

            if (map !== undefined) {
                Object.assign(entry, { sourceMap: map });
            } else if (isTypeScriptCoverageSource(fileURLToPath(entry.url))) {
                const source = await readFile(fileURLToPath(entry.url), 'utf8');

                Object.assign(entry, { fake: false, source: nativeTypeScriptCoverageSource(source) });
            }
        },
        sourcePath(sourcePath, info) {
            return typeof info.url === 'string' && info.url.startsWith('file:')
                ? path.relative(request.projectRoot, fileURLToPath(info.url)).split(path.sep).join('/')
                : sourcePath;
        },
        sourceIncluded(sourcePath) {
            const filePath = sourceFilePath(sourcePath, request.projectRoot);

            return loaded.sources.has(filePath) ||
                runtimeFiles.has(filePath);
        }
    };
}
