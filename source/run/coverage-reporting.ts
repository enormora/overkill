import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CoverageReport,
    type CoverageResults,
    type ReportDescription,
    type V8CoverageEntry
} from 'monocart-coverage-reports';
import { transform } from 'sucrase';
import type { NonEmptyReadonlyArray } from '../assertion-protocol/assertion-node-shape.ts';
import type {
    CoverageArtifactPayload,
    CoverageMetric,
    CoverageReportFile
} from '../engine/coverage-artifact.ts';
import { isPathInside } from './path-containment.ts';
import type { CoverageOutput, RunCoverageSourcePolicy } from './run-types.ts';

export type CoverageSourceScope = RunCoverageSourcePolicy & {
    readonly excludedFiles: ReadonlySet<string>;
};

export type CoverageReportRequest = {
    readonly coverageDirectory: string;
    readonly outputs: readonly CoverageOutput[];
    readonly projectRoot: string;
    readonly rawDataDirectory: string;
    readonly sourceScope: CoverageSourceScope;
};

export type CoverageReportResult = {
    readonly reports: readonly CoverageReportFile[];
    readonly summary: CoverageArtifactPayload['summary'];
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

async function allFilesOptions(request: CoverageReportRequest): Promise<CoverageAllOptions | null> {
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
            if (typeScriptSourceExtensions.has(path.extname(entry.url))) {
                Object.assign(entry, transformedTypeScript(entry.source, entry.url));
            }
        }
    };
}

type ConfiguredCoverageReport = {
    readonly backend: ReportDescription;
    readonly file: CoverageReportFile;
};

function coverageReportBackend(
    output: CoverageOutput,
    relativePath: string,
    projectRoot: string
): ReportDescription {
    if (output === 'html') {
        return [ 'html', { subdir: 'html' } ];
    }

    if (output === 'json') {
        return [ 'json', { file: relativePath } ];
    }

    if (output === 'lcov') {
        return [ 'lcovonly', { file: relativePath, projectRoot } ];
    }

    return output === 'text'
        ? [ 'text', { file: relativePath } ]
        : [ 'v8', { inline: true, outputFile: relativePath } ];
}

function configuredCoverageReport(
    output: CoverageOutput,
    request: CoverageReportRequest
): ConfiguredCoverageReport {
    const relativePaths: Readonly<Record<CoverageOutput, string>> = {
        html: 'html/index.html',
        json: 'coverage-final.json',
        lcov: 'lcov.info',
        text: 'coverage.txt',
        v8: 'v8/index.html'
    };
    const relativePath = relativePaths[output];

    return {
        backend: coverageReportBackend(output, relativePath, request.projectRoot),
        file: {
            format: output,
            path: path.join(request.coverageDirectory, relativePath)
        }
    };
}

function configuredCoverageReports(request: CoverageReportRequest): readonly ConfiguredCoverageReport[] {
    return request.outputs.map(function configureCoverageReport(output) {
        return configuredCoverageReport(output, request);
    });
}

function metric(results: CoverageResults, name: 'branches' | 'functions' | 'lines'): CoverageMetric {
    const value = results.summary[name];

    return { covered: value.covered, total: value.total };
}

export async function generateCoverageReports(
    request: CoverageReportRequest
): Promise<CoverageReportResult> {
    const all = await allFilesOptions(request);
    const configuredReports = configuredCoverageReports(request);
    const report = new CoverageReport({
        ...all === null ? {} : { all },
        baseDir: request.projectRoot,
        clean: false,
        entryFilter(entry) {
            return entryIncluded(entry, request);
        },
        logging: 'off',
        outputDir: request.coverageDirectory,
        reports: configuredReports.length === 0
            ? [ [ 'none' ] ]
            : configuredReports.map(function backendReport(configuredReport) {
                return configuredReport.backend;
            }),
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
        reports: configuredReports.map(function reportFile(configuredReport) {
            return configuredReport.file;
        }),
        summary: {
            branches: metric(results, 'branches'),
            functions: metric(results, 'functions'),
            lines: metric(results, 'lines')
        }
    };
}
