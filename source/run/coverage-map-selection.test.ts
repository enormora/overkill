import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromObject } from 'convert-source-map';
import * as typescript from 'typescript';
import { createCoverageTranspiler } from '../test-support/coverage-transpilation.ts';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { collectCoverageScript, withCoverageSources } from '../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from './coverage-reporting.ts';

const transformCoverageFixture = createCoverageTranspiler(typescript);
const application = 'export function value(): number { return 42; }\nvalue();\n';
const test = 'function check(): number { return 42; }\ncheck();\n';
const applicationOutput = transformCoverageFixture(application, {
    filePath: 'src/application.ts',
    sourceMapOptions: { compiledFilename: 'generated/bundle.mjs' }
});
const testOutput = transformCoverageFixture(test, {
    filePath: 'src/check.test.ts',
    sourceMapOptions: { compiledFilename: 'generated/bundle.mjs' }
});
const applicationMap = {
    ...applicationOutput.sourceMap,
    sources: [ '../src/application.ts' ],
    sourcesContent: [ application ]
};
const testMap = { ...testOutput.sourceMap, sources: [ '../src/check.test.ts' ], sourcesContent: [ test ] };

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-map-selection.test.ts',
    children: [
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage selects application originals from a test bundle and applies explicit original excludes',
            async body(scope) {
                const map = {
                    version: 3,
                    sections: [
                        { offset: { line: 0, column: 0 }, map: applicationMap },
                        { offset: { line: applicationOutput.code.split('\n').length - 1, column: 0 }, map: testMap }
                    ]
                };

                await withCoverageSources([
                    { file: 'src/application.ts', loaded: false, source: application },
                    { file: 'src/check.test.ts', loaded: false, source: test },
                    {
                        file: 'generated/bundle.mjs',
                        loaded: false,
                        source: `${applicationOutput.code}${testOutput.code}\n${fromObject(map).toComment()}\n`
                    }
                ], async function verifyBundle(fixture) {
                    await collectCoverageScript(fixture, 'generated/bundle.mjs');
                    const result = await generateCoverageReports({
                        ...fixture,
                        outputs: [ 'lcov' ],
                        sourceScope: {
                            exclude: [ '**/*.test.ts' ],
                            excludedFiles: new Set([ path.join(fixture.projectRoot, 'generated/bundle.mjs') ]),
                            include: [ 'src/**/*.ts' ],
                            mode: 'all'
                        }
                    });
                    const lcov = await readFile(path.join(fixture.coverageDirectory, 'lcov.info'), 'utf8');

                    scope.assert.includes(lcov, 'application.ts');
                    scope.assert.false(lcov.includes('check.test.ts'));
                    scope.assert.false(lcov.includes('bundle.mjs'));
                    scope.assert.equal(result.summary.functions.total, 1);
                    scope.assert.equal(result.summary.functions.covered, 1);
                });
                return scope.assert.collect();
            }
        }),
        ...[
            { name: 'known-test', source: '../src/application.ts' },
            { name: 'outside-project', source: '../../outside/application.ts' },
            { name: 'dependency', source: '../node_modules/dependency/application.ts' }
        ]
            .map(function excludedOriginal(scenario) {
                return createTestCase({
                    annotations: {},
                    controls: {},
                    definitionLocations: [ { kind: 'unknown' } ],
                    title: `coverage excludes ${scenario.name} originals without losing unrelated JavaScript`,
                    async body(scope) {
                        await withCoverageSources([
                            { file: 'src/application.ts', loaded: false, source: application },
                            { file: 'unrelated.mjs', loaded: true, source: 'export const value = 42;\n' },
                            {
                                file: 'generated/bundle.mjs',
                                loaded: false,
                                source: `${applicationOutput.code}\n${
                                    fromObject({ ...applicationMap, sources: [ scenario.source ] }).toComment()
                                }\n`
                            }
                        ], async function verifyExclusion(fixture) {
                            await collectCoverageScript(fixture, 'generated/bundle.mjs');
                            const result = await generateCoverageReports({
                                ...fixture,
                                outputs: [ 'lcov' ],
                                sourceScope: {
                                    exclude: [],
                                    excludedFiles: scenario.name === 'known-test'
                                        ? new Set([ path.join(fixture.projectRoot, 'generated/bundle.mjs') ])
                                        : new Set(),
                                    mode: 'loaded'
                                }
                            });
                            const lcov = await readFile(path.join(fixture.coverageDirectory, 'lcov.info'), 'utf8');

                            scope.assert.includes(lcov, 'unrelated.mjs');
                            scope.assert.false(lcov.includes('application.ts'));
                            scope.assert.equal(result.summary.lines.total, 1);
                        });
                        return scope.assert.collect();
                    }
                });
            })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
