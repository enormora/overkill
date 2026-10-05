import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CoverageReport } from 'monocart-coverage-reports';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { collectCoverageScript, withCoverageSources } from '../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from './coverage-reporting.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-unloaded-sources.test.ts',
    children: [
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'all-files reporting synthesizes unloaded-only sources without changing native raw data',
            async body(scope) {
                await withCoverageSources([
                    { file: 'runner.mjs', loaded: false, source: 'export const seed = 42;\n' },
                    { file: 'unloaded.ts', loaded: false, source: 'export function value(): number { return 42; }\n' }
                ], async function verifyUnloaded(fixture) {
                    await collectCoverageScript(fixture, 'runner.mjs');
                    const files = await readdir(fixture.rawDataDirectory);
                    const before = await Promise.all(files.map(async function rawData(file) {
                        return await readFile(path.join(fixture.rawDataDirectory, file), 'utf8');
                    }));
                    const result = await generateCoverageReports({
                        ...fixture,
                        outputs: [ 'lcov' ],
                        sourceScope: { exclude: [], excludedFiles: new Set(), include: [ 'unloaded.ts' ], mode: 'all' }
                    });
                    const after = await Promise.all(files.map(async function rawData(file) {
                        return await readFile(path.join(fixture.rawDataDirectory, file), 'utf8');
                    }));

                    scope.assert.deepEqual(after, before);
                    scope.assert.equal(result.summary.functions.total, 1);
                    scope.assert.equal(result.summary.functions.covered, 0);
                    scope.assert.true(result.summary.lines.total > 0);
                    scope.assert.equal(result.summary.lines.covered, 0);
                });
                return scope.assert.collect();
            }
        }),
        ...[ 'types.ts', 'missing.ts' ].map(function emptyScope(include) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `coverage rejects empty executable scope for ${include}`,
                async body(scope) {
                    await withCoverageSources([
                        {
                            file: 'types.ts',
                            loaded: true,
                            source: '/** Domain contract. */\nexport interface Value { value: number; }\n'
                        }
                    ], async function verifyEmpty(fixture) {
                        await scope.assert.rejects(async function reportEmptySources() {
                            await generateCoverageReports({
                                ...fixture,
                                outputs: [],
                                sourceScope: {
                                    exclude: [],
                                    excludedFiles: new Set(),
                                    include: [ include ],
                                    mode: 'all'
                                }
                            });
                        }, { message: 'Coverage source selection contains no executable sources.' });
                    });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage rejects missing native data instead of synthesizing a successful run',
            async body(scope) {
                await withCoverageSources([
                    { file: 'value.ts', loaded: false, source: 'export const value = 42;\n' }
                ], async function verifyNoNativeData(fixture) {
                    await scope.assert.rejects(async function reportMissingNativeData() {
                        await generateCoverageReports({
                            ...fixture,
                            outputs: [],
                            sourceScope: { exclude: [], excludedFiles: new Set(), include: [ '*.ts' ], mode: 'all' }
                        });
                    }, { message: 'Coverage collection produced no native V8 data.' });
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage rejects corrupt native data',
            async body(scope) {
                await withCoverageSources([], async function verifyCorruptData(fixture) {
                    await writeFile(path.join(fixture.rawDataDirectory, 'coverage-fixture.json'), '{');
                    await scope.assert.rejects(async function reportCorruptData() {
                        await generateCoverageReports({
                            ...fixture,
                            outputs: [],
                            sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                        });
                    }, { message: /JSON/u });
                });
                return scope.assert.collect();
            }
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage does not reuse backend cache from an interrupted report',
            async body(scope) {
                await withCoverageSources([
                    { file: 'value.mjs', loaded: true, source: 'export const value = 42;\n' },
                    { file: 'unloaded.ts', loaded: false, source: 'export function value(): number { return 42; }\n' }
                ], async function verifyFreshCache(fixture) {
                    const interrupted = new CoverageReport({ outputDir: fixture.coverageDirectory, logging: 'off' });

                    await interrupted.addFromDir(fixture.rawDataDirectory);
                    const result = await generateCoverageReports({
                        ...fixture,
                        outputs: [],
                        sourceScope: { exclude: [], excludedFiles: new Set(), include: [ 'unloaded.ts' ], mode: 'all' }
                    });

                    scope.assert.equal(result.summary.functions.total, 1);
                    scope.assert.equal(result.summary.functions.covered, 0);
                    scope.assert.equal(result.summary.lines.covered, 0);
                });
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
