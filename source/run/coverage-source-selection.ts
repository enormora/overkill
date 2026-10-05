import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CoverageReport, V8CoverageEntry } from 'monocart-coverage-reports';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import { isPathInside } from './path-containment.ts';
import { readNativeCoverageBatches, type CoverageNativeBatch } from './coverage-native-data.ts';
import {
    hasRuntimeCoverageSource,
    isTypeScriptCoverageSource,
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

const supportedSourceExtensions = new Set([ '.cjs', '.cts', '.js', '.mjs', '.mts', '.ts' ]);

function entryFilePath(url: string): string | null {
    if (!url.startsWith('file:')) {
        return null;
    }

    return path.resolve(fileURLToPath(url));
}

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

function sourceIncluded(sourcePath: string, request: CoverageSourceRequest): boolean {
    return includedSourceFile(sourceFilePath(sourcePath, request.projectRoot), request);
}

async function isRuntimeSourceFile(filePath: string, request: CoverageSourceRequest): Promise<boolean> {
    const extension = path.extname(filePath);

    if (!supportedSourceExtensions.has(extension) || !includedSourceFile(filePath, request)) {
        return false;
    }

    if (!isTypeScriptCoverageSource(filePath)) {
        return true;
    }

    return hasRuntimeCoverageSource(await readFile(filePath, 'utf8'), filePath);
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

async function allFilesOptions(request: CoverageSourceRequest): Promise<CoverageAllOptions | null> {
    const { sourceScope } = request;

    if (sourceScope.mode === 'loaded') {
        return null;
    }

    const runtimeFiles = await allRuntimeFiles(request, sourceScope);

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
}> {
    const batches = await readNativeCoverageBatches(request.rawDataDirectory);
    const includedEntries = new Set<string>();

    for (const batch of batches) {
        for (const entry of batch.entries) {
            const filePath = entryFilePath(entry.url);

            if (filePath !== null && await isRuntimeSourceFile(filePath, request)) {
                includedEntries.add(entry.url);
            }
        }
    }

    return {
        all: await allFilesOptions(request),
        batches,
        entryIncluded(entry) {
            return includedEntries.has(entry.url);
        },
        sourceIncluded(sourcePath) {
            return sourceIncluded(sourcePath, request);
        }
    };
}
