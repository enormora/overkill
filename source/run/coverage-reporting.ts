import path from 'node:path';
import {
    CoverageReport,
    type CoverageResults,
    type ReportDescription
} from 'monocart-coverage-reports';
import type {
    CoverageArtifactPayload,
    CoverageMetric,
    CoverageReportFile
} from '../engine/coverage-artifact.ts';
import { prepareCoverageSources, type CoverageSourceScope } from './coverage-source-selection.ts';
import type { CoverageOutput } from './run-types.ts';

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
    const sources = await prepareCoverageSources(request);
    const configuredReports = configuredCoverageReports(request);
    const report = new CoverageReport({
        ...sources.all === null ? {} : { all: sources.all },
        baseDir: request.projectRoot,
        clean: false,
        entryFilter: sources.entryIncluded,
        logging: 'off',
        outputDir: request.coverageDirectory,
        reports: configuredReports.length === 0
            ? [ [ 'none' ] ]
            : configuredReports.map(function backendReport(configuredReport) {
                return configuredReport.backend;
            }),
        sourceFilter: sources.sourceIncluded
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
