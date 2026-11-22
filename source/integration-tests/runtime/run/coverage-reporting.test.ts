import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    defineCompositeAssertion,
    type CompositeCheckBuilder,
    type CompositeAssertionReturn
} from '@overkill-dev/test/assert';

import { suite, test } from '@overkill-dev/test';

import type { V8CoverageEntry } from 'monocart-coverage-reports';

import { generateCoverageReports } from '../../../run/coverage-reporting.ts';

const sourcePath = 'source/integration-tests/runtime/fixtures/coverage-source.ts';
const excludedSourcePath = 'source/integration-tests/runtime/fixtures/coverage-types.ts';

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
                    pathToFileURL(path.resolve('node_modules/js-tokens/index.js')).href,
                    '4',
                    source.length
                )
            ],
            timestamp: Date.now()
        })
    );
}

const configuredReportFilesChecks = async function (
    check: CompositeCheckBuilder<'assert'>,
    report: Awaited<ReturnType<typeof generateCoverageReports>>
): Promise<CompositeAssertionReturn<'assert'>> {
    const reportFiles = await Promise.all(report.reports.map(async function reportFile(file) {
        return await stat(file.path);
    }));
    return check.group([
        check.deepEqual(
            report.reports.map(function reportFormat(file) {
                return file.format;
            }),
            [ 'html', 'json', 'lcov', 'text', 'v8' ]
        ),
        check.true(reportFiles.every(function isFile(file) {
            return file.isFile();
        }))
    ]);
};

const assertLoadedReport = defineCompositeAssertion({
    name: 'loaded report',
    async assert(check, temporaryRoot: string) {
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
        return check.group([
            await configuredReportFilesChecks(check.annotated('configured report files'), report),
            check.true(report.summary.lines.total > 0),
            check.true(lcov.includes('coverage-source.ts'))
        ]);
    }
});

const assertRawOnlyReport = defineCompositeAssertion({
    name: 'raw only report',
    async assert(check, temporaryRoot: string) {
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
        return check.group([ check.deepEqual(report.reports, []), check.true(report.summary.lines.total > 0) ]);
    }
});

const assertAllFilesReport = defineCompositeAssertion({
    name: 'all files report',
    async assert(check, temporaryRoot: string) {
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
                include: [ 'package.json', 'source/integration-tests/runtime/fixtures/coverage-*' ],
                mode: 'all'
            }
        });
        const lcov = await readFile(path.join(coverageDirectory, 'lcov.info'), 'utf8');
        return check.group([
            check.true(lcov.includes('coverage-unloaded.ts')),
            check.true(lcov.includes('coverage-javascript.js')),
            check.false(lcov.includes('coverage-types.ts'))
        ]);
    }
});

const assertEmptyReportRejected = defineCompositeAssertion({
    name: 'empty report rejected',
    async assert(check, temporaryRoot: string) {
        const coverageDirectory = path.join(temporaryRoot, 'report');
        const rawDataDirectory = path.join(temporaryRoot, 'raw');
        await writeRawCoverage(rawDataDirectory, await readFile(sourcePath, 'utf8'));
        return check.group([
            await check.rejects(async function generateEmptyCoverageReport() {
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
            }, { message: 'Coverage source selection contains no executable sources.' })
        ]);
    }
});

export const testNode = suite('Coverage report generation', [
    test(
        'emits every configured report format from raw process data',
        async function (scope) {
            const temporaryRoot = await createTemporaryCoverageRoot();

            try {
                await scope.assert(assertLoadedReport, temporaryRoot);
            } finally {
                await rm(temporaryRoot, { force: true, recursive: true });
            }

            return scope.assert.collect();
        }
    ),
    test('supports raw-only coverage', async function (scope) {
        const temporaryRoot = await createTemporaryCoverageRoot();

        try {
            await scope.assert(assertRawOnlyReport, temporaryRoot);
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }

        return scope.assert.collect();
    }),
    test(
        'synthesizes unloaded TypeScript runtime files',
        async function (scope) {
            const temporaryRoot = await createTemporaryCoverageRoot();

            try {
                await scope.assert(assertAllFilesReport, temporaryRoot);
            } finally {
                await rm(temporaryRoot, { force: true, recursive: true });
            }

            return scope.assert.collect();
        }
    ),
    test('rejects scopes without executable sources', async function (scope) {
        const temporaryRoot = await createTemporaryCoverageRoot();

        try {
            await scope.assert(assertEmptyReportRejected, temporaryRoot);
        } finally {
            await rm(temporaryRoot, { force: true, recursive: true });
        }

        return scope.assert.collect();
    })
]);
