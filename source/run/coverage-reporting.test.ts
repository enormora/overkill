import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { V8CoverageEntry } from 'monocart-coverage-reports';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { generateCoverageReports } from './coverage-reporting.ts';
import { testNode as typeOnlyTestNode } from './coverage-type-only.test.ts';

const sourcePath = 'source/integration-tests/run/fixtures/coverage-source.ts';
const excludedSourcePath = 'source/integration-tests/run/fixtures/coverage-types.ts';

async function createTemporaryCoverageRoot(): Promise<string> {
    return await mkdtemp(path.join(tmpdir(), 'overkill-coverage-reporting-'));
}

function rawCoverageEntry(url: string, scriptId: string, sourceLength: number): V8CoverageEntry {
    return {
        functions: [ {
            functionName: '',
            isBlockCoverage: true,
            ranges: [ { count: 1, endOffset: sourceLength, startOffset: 0 } ]
        } ],
        scriptId,
        url
    };
}

async function writeRawCoverage(rawDataDirectory: string, source: string): Promise<void> {
    await mkdir(rawDataDirectory, { recursive: true });
    await writeFile(
        path.join(rawDataDirectory, 'coverage-test.json'),
        JSON.stringify({
            result: [
                rawCoverageEntry(pathToFileURL(path.resolve(sourcePath)).href, '1', source.length),
                rawCoverageEntry(path.resolve(excludedSourcePath), '2', source.length),
                rawCoverageEntry('relative-source.ts', '3', source.length),
                rawCoverageEntry(
                    pathToFileURL(path.resolve('node_modules/sucrase/dist/index.js')).href,
                    '4',
                    source.length
                )
            ],
            timestamp: Date.now()
        })
    );
}

async function assertConfiguredReportFiles(
    scope: OverkillScope,
    report: Awaited<ReturnType<typeof generateCoverageReports>>
): Promise<void> {
    const reportFiles = await Promise.all(report.reports.map(async function reportFile(file) {
        return await stat(file.path);
    }));

    scope.assert.deepEqual(
        report.reports.map(function reportFormat(file) {
            return file.format;
        }),
        [ 'html', 'json', 'lcov', 'text', 'v8' ]
    );
    scope.assert.true(reportFiles.every(function isFile(file) {
        return file.isFile();
    }));
}

async function assertLoadedReport(scope: OverkillScope, temporaryRoot: string): Promise<void> {
    const coverageDirectory = path.join(temporaryRoot, 'report');
    const rawDataDirectory = path.join(temporaryRoot, 'raw');
    const source = await readFile(sourcePath, 'utf8');

    await writeRawCoverage(rawDataDirectory, source);
    const report = await generateCoverageReports({
        coverageDirectory,
        outputs: [ 'html', 'json', 'lcov', 'text', 'v8' ],
        projectRoot: process.cwd(),
        rawDataDirectory,
        sourceScope: {
            exclude: [],
            excludedFiles: new Set([ path.resolve(excludedSourcePath) ]),
            mode: 'loaded'
        }
    });
    const lcov = await readFile(path.join(coverageDirectory, 'lcov.info'), 'utf8');

    await assertConfiguredReportFiles(scope, report);
    scope.assert.true(report.summary.lines.total > 0);
    scope.assert.true(lcov.includes('coverage-source.ts'));
}

async function assertRawOnlyReport(scope: OverkillScope, temporaryRoot: string): Promise<void> {
    const coverageDirectory = path.join(temporaryRoot, 'report');
    const rawDataDirectory = path.join(temporaryRoot, 'raw');

    await writeRawCoverage(rawDataDirectory, await readFile(sourcePath, 'utf8'));
    const report = await generateCoverageReports({
        coverageDirectory,
        outputs: [],
        projectRoot: process.cwd(),
        rawDataDirectory,
        sourceScope: {
            exclude: [],
            excludedFiles: new Set([ path.resolve(excludedSourcePath) ]),
            mode: 'loaded'
        }
    });

    scope.assert.deepEqual(report.reports, []);
    scope.assert.true(report.summary.lines.total > 0);
}

async function assertAllFilesReport(scope: OverkillScope, temporaryRoot: string): Promise<void> {
    const coverageDirectory = path.join(temporaryRoot, 'report');
    const rawDataDirectory = path.join(temporaryRoot, 'raw');

    await writeRawCoverage(rawDataDirectory, await readFile(sourcePath, 'utf8'));
    await generateCoverageReports({
        coverageDirectory,
        outputs: [ 'lcov' ],
        projectRoot: process.cwd(),
        rawDataDirectory,
        sourceScope: {
            exclude: [ '**/*.test.ts' ],
            excludedFiles: new Set([ path.resolve(excludedSourcePath) ]),
            include: [ 'package.json', 'source/integration-tests/run/fixtures/coverage-*' ],
            mode: 'all'
        }
    });
    const lcov = await readFile(path.join(coverageDirectory, 'lcov.info'), 'utf8');

    scope.assert.true(lcov.includes('coverage-unloaded.ts'));
    scope.assert.true(lcov.includes('coverage-javascript.js'));
    scope.assert.false(lcov.includes('coverage-types.ts'));
}

async function assertEmptyReportRejected(scope: OverkillScope, temporaryRoot: string): Promise<void> {
    const coverageDirectory = path.join(temporaryRoot, 'report');
    const rawDataDirectory = path.join(temporaryRoot, 'raw');

    await writeRawCoverage(rawDataDirectory, await readFile(sourcePath, 'utf8'));
    await scope.assert.rejects(async function generateEmptyCoverageReport() {
        await generateCoverageReports({
            coverageDirectory,
            outputs: [ 'lcov' ],
            projectRoot: process.cwd(),
            rawDataDirectory,
            sourceScope: {
                exclude: [],
                excludedFiles: new Set([ path.resolve(sourcePath), path.resolve(excludedSourcePath) ]),
                mode: 'loaded'
            }
        });
    }, { message: 'Coverage backend produced no result.' });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/coverage-reporting.test.ts',
    annotations: {},
    controls: {},
    children: [
        typeOnlyTestNode,
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'generateCoverageReports() emits every configured report format from raw process data',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const temporaryRoot = await createTemporaryCoverageRoot();

                try {
                    await assertLoadedReport(scope, temporaryRoot);
                } finally {
                    await rm(temporaryRoot, { force: true, recursive: true });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'generateCoverageReports() supports raw-only coverage',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const temporaryRoot = await createTemporaryCoverageRoot();

                try {
                    await assertRawOnlyReport(scope, temporaryRoot);
                } finally {
                    await rm(temporaryRoot, { force: true, recursive: true });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'generateCoverageReports() synthesizes unloaded TypeScript runtime files',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const temporaryRoot = await createTemporaryCoverageRoot();

                try {
                    await assertAllFilesReport(scope, temporaryRoot);
                } finally {
                    await rm(temporaryRoot, { force: true, recursive: true });
                }

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'generateCoverageReports() rejects empty backend results',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const temporaryRoot = await createTemporaryCoverageRoot();

                try {
                    await assertEmptyReportRejected(scope, temporaryRoot);
                } finally {
                    await rm(temporaryRoot, { force: true, recursive: true });
                }

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
