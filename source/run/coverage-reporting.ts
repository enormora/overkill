import path from 'node:path';
import {
    CoverageReport,
    type V8CoverageEntry,
    type CoverageResults,
    type ReportDescription
} from 'monocart-coverage-reports';
import type {
    CoverageArtifactPayload,
    CoverageMetric,
    CoverageReportFile
} from '../engine/coverage-artifact.ts';
import type { CoverageOutput } from '../config/types.ts';
import {
    prepareCoverageSources,
    createCoverageSourceAccess,
    type CoverageSourceScope,
    type CoverageSourceAccess
} from './coverage-source-selection.ts';
import type { CoverageNativeBatch } from './coverage-native-data.ts';

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

type CoverageBackendResult = Pick<CoverageResults, 'summary'>;
export type CoverageReportBackend = {
    readonly hasCache: () => boolean;
    readonly add: (entries: readonly V8CoverageEntry[]) => Promise<unknown>;
    readonly addFromDir: (path: string) => Promise<unknown>;
    readonly generate: () => Promise<CoverageBackendResult | undefined>;
};
export type CoverageReportingRuntime = {
    readonly sources: CoverageSourceAccess;
    readonly createReport: (
        options: NonNullable<ConstructorParameters<typeof CoverageReport>[0]>
    ) => CoverageReportBackend;
};

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

function metric(results: CoverageBackendResult, name: 'branches' | 'functions' | 'lines'): CoverageMetric {
    const value = results.summary[name];

    return { covered: value.covered, total: value.total };
}

async function initializeFilteredCoverage(
    report: CoverageReportBackend,
    batches: readonly CoverageNativeBatch[]
): Promise<void> {
    if (report.hasCache()) {
        return;
    }
    const batch = batches.find(function hasNativeEntries(candidate) {
        return candidate.entries.length > 0;
    });

    if (batch === undefined) {
        throw new Error('Coverage collection produced no native V8 data.');
    }
    await report.add(Array.from(batch.entries));
}

function hasExecutableCoverage(results: CoverageBackendResult): boolean {
    return ([ 'branches', 'functions', 'lines' ] as const).some(function hasExecutableMetric(name) {
        return results.summary[name].total > 0;
    });
}

async function generateExecutableCoverageReport(report: CoverageReportBackend): Promise<CoverageBackendResult> {
    const results = await report.generate();

    if (results === undefined) {
        throw new Error('Coverage backend produced no result.');
    }
    if (!hasExecutableCoverage(results)) {
        throw new Error('Coverage source selection contains no executable sources.');
    }
    return results;
}

export async function collectCoverageReports(
    request: CoverageReportRequest,
    runtime: CoverageReportingRuntime
): Promise<CoverageReportResult> {
    const sources = await prepareCoverageSources(request, runtime.sources);
    const configuredReports = configuredCoverageReports(request);
    const report = runtime.createReport({
        ...sources.all === null ? {} : { all: sources.all },
        baseDir: request.projectRoot,
        clean: false,
        cleanCache: true,
        entryFilter: sources.entryIncluded,
        logging: 'off',
        onEntry: sources.onEntry,
        outputDir: request.coverageDirectory,
        reports: configuredReports.length === 0
            ? [ [ 'none' ] ]
            : configuredReports.map(function backendReport(configuredReport) {
                return configuredReport.backend;
            }),
        sourceFilter: sources.sourceIncluded,
        sourcePath: sources.sourcePath
    });

    await report.addFromDir(request.rawDataDirectory);
    await initializeFilteredCoverage(report, sources.batches);
    const results = await generateExecutableCoverageReport(report);

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

export async function generateCoverageReports(request: CoverageReportRequest): Promise<CoverageReportResult> {
    return await collectCoverageReports(request, {
        sources: createCoverageSourceAccess(),
        createReport(options) {
            return new CoverageReport(options);
        }
    });
}
