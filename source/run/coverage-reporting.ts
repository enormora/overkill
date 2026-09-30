import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CoverageReport,
    type CoverageResults,
    type V8CoverageEntry
} from 'monocart-coverage-reports';
import { transform } from 'sucrase';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type {
    CoverageArtifactPayload,
    CoverageMetric
} from '../engine/coverage-artifact.ts';
import { isPathInside } from './path-containment.ts';

export type CoverageSourceScope = {
    readonly exclude: readonly string[];
    readonly excludedFiles: ReadonlySet<string>;
    readonly include: NonEmptyReadonlyArray<string>;
    readonly kind: 'all';
} | {
    readonly excludedFiles: ReadonlySet<string>;
    readonly kind: 'loaded';
};

export type CoverageReportRequest = {
    readonly coverageDirectory: string;
    readonly projectRoot: string;
    readonly rawDataDirectory: string;
    readonly sourceScope: CoverageSourceScope;
};

type AllFileEntry = {
    readonly source: string;
    readonly url: string;
};
type TransformedSource = {
    readonly source: string;
    readonly sourceMap: unknown;
};
type CoverageReportOptions = NonNullable<ConstructorParameters<typeof CoverageReport>[0]>;
type CoverageAllOptions = NonNullable<CoverageReportOptions['all']>;

const supportedSourceExtensions = new Set([ '.cjs', '.cts', '.js', '.mjs', '.mts', '.ts' ]);
const typeScriptSourceExtensions = new Set([ '.cts', '.mts', '.ts' ]);

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

function includedSourceFile(filePath: string, request: CoverageReportRequest): boolean {
    if (!includedProjectFile(filePath, request.projectRoot, request.sourceScope.excludedFiles)) {
        return false;
    }

    return request.sourceScope.kind === 'loaded' || matchesSourcePatterns(
        filePath,
        request.projectRoot,
        request.sourceScope.include,
        request.sourceScope.exclude
    );
}

function entryIncluded(entry: V8CoverageEntry, request: CoverageReportRequest): boolean {
    const filePath = entryFilePath(entry.url);

    return filePath !== null && includedSourceFile(filePath, request);
}

function sourceIncluded(sourcePath: string, request: CoverageReportRequest): boolean {
    return includedSourceFile(sourceFilePath(sourcePath, request.projectRoot), request);
}

function transformedTypeScript(source: string, filePath: string): TransformedSource {
    const result = transform(source, {
        filePath,
        sourceMapOptions: {
            compiledFilename: filePath.replace(/\.[cm]?ts$/u, '.js')
        },
        transforms: [ 'typescript' ]
    });

    return {
        source: result.code,
        sourceMap: { ...result.sourceMap, sourcesContent: [ source ] }
    };
}

function hasRuntimeTypeScript(source: string): boolean {
    return source
        .replace(/^export \{\};?\s*$/mu, '')
        .replace(/^\/\/# sourceMappingURL=.*$/mu, '')
        .trim() !== '';
}

async function isRuntimeSourceFile(filePath: string, request: CoverageReportRequest): Promise<boolean> {
    const extension = path.extname(filePath);

    if (!supportedSourceExtensions.has(extension) || !includedSourceFile(filePath, request)) {
        return false;
    }

    if (!typeScriptSourceExtensions.has(extension)) {
        return true;
    }

    const transformed = transformedTypeScript(await readFile(filePath, 'utf8'), filePath);

    return hasRuntimeTypeScript(transformed.source);
}

async function allRuntimeFiles(
    request: CoverageReportRequest,
    sourceScope: Extract<CoverageSourceScope, { readonly kind: 'all'; }>
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

async function allFilesOptions(request: CoverageReportRequest): Promise<CoverageAllOptions | null> {
    const { sourceScope } = request;

    if (sourceScope.kind === 'loaded') {
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
            if (typeScriptSourceExtensions.has(path.extname(entry.url))) {
                Object.assign(entry, transformedTypeScript(entry.source, entry.url));
            }
        }
    };
}

function metric(results: CoverageResults, name: 'branches' | 'functions' | 'lines'): CoverageMetric {
    const value = results.summary[name];

    return { covered: value.covered, total: value.total };
}

export async function generateCoverageReports(
    request: CoverageReportRequest
): Promise<CoverageArtifactPayload['summary']> {
    const all = await allFilesOptions(request);
    const report = new CoverageReport({
        ...all === null ? {} : { all },
        baseDir: request.projectRoot,
        clean: false,
        entryFilter(entry) {
            return entryIncluded(entry, request);
        },
        logging: 'off',
        outputDir: request.coverageDirectory,
        reports: [
            [ 'v8', { inline: true, outputFile: 'v8/index.html' } ],
            [ 'lcovonly', { file: 'lcov.info', projectRoot: request.projectRoot } ]
        ],
        sourceFilter(sourcePath) {
            return sourceIncluded(sourcePath, request);
        }
    });

    await report.addFromDir(request.rawDataDirectory);
    const results = await report.generate();

    if (results === undefined) {
        throw new Error('Coverage backend produced no result.');
    }

    return {
        branches: metric(results, 'branches'),
        functions: metric(results, 'functions'),
        lines: metric(results, 'lines')
    };
}
