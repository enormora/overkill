import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromObject } from 'convert-source-map';
import { transform } from 'sucrase';
import { encodedMap, presortedDecodedMap } from '@jridgewell/trace-mapping';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { collectCoverageScript, withCoverageSources } from '../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from './coverage-reporting.ts';

const source = 'export function value(): number { return 42; }\nvalue();\n';
const typeOnlySource = '/** Domain type. */\nexport type Value = number;\n';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-map-content.test.ts',
    children: [
        ...[ 'missing-content', 'virtual-source', 'type-only' ].map(function originalContent(scenario) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `coverage handles ${scenario} originals without counting generated containers`,
                async body(scope) {
                    const original = scenario === 'type-only' ? typeOnlySource : source;
                    const compiled = transform(original, {
                        filePath: 'value.ts',
                        sourceMapOptions: { compiledFilename: 'compiled.mjs' },
                        transforms: [ 'typescript' ]
                    });
                    const map = {
                        ...compiled.sourceMap,
                        sources: [ scenario === 'virtual-source' ? 'webpack://virtual/value.ts' : 'value.ts' ],
                        sourcesContent: [ null ]
                    };

                    await withCoverageSources([
                        { file: 'value.ts', loaded: false, source: original },
                        { file: 'unrelated.mjs', loaded: true, source: 'export const value = 42;\n' },
                        {
                            file: 'compiled.mjs',
                            loaded: false,
                            source: `${compiled.code}\n${fromObject(map).toComment()}\n`
                        }
                    ], async function verifyOriginal(fixture) {
                        await collectCoverageScript(fixture, 'compiled.mjs');
                        const result = await generateCoverageReports({
                            ...fixture,
                            outputs: [ 'lcov' ],
                            sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                        });
                        const lcov = await readFile(path.join(fixture.coverageDirectory, 'lcov.info'), 'utf8');

                        scope.assert.includes(lcov, 'unrelated.mjs');
                        scope.assert.false(lcov.includes('compiled.mjs'));
                        if (scenario === 'missing-content') {
                            scope.assert.includes(lcov, 'value.ts');
                            scope.assert.equal(result.summary.functions.covered, 1);
                        } else {
                            scope.assert.false(lcov.includes('value.ts'));
                            scope.assert.equal(result.summary.lines.total, 1);
                        }
                    });
                    return scope.assert.collect();
                }
            });
        }),
        ...[ 'source-index', 'name-index' ].map(function invalidMappingIndex(scenario) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `coverage rejects an out-of-range ${scenario}`,
                async body(scope) {
                    const compiled = transform(source, { transforms: [ 'typescript' ] });
                    const map = encodedMap(presortedDecodedMap({
                        version: 3,
                        sources: [ 'value.ts' ],
                        sourcesContent: [ source ],
                        names: [],
                        mappings: scenario === 'source-index' ? [ [ [ 0, 1, 0, 0 ] ] ] : [ [ [ 0, 0, 0, 0, 1 ] ] ]
                    }));

                    await withCoverageSources([
                        {
                            file: 'compiled.mjs',
                            loaded: true,
                            source: `${compiled.code}\n${fromObject(map).toComment()}\n`
                        }
                    ], async function verifyInvalidIndex(fixture) {
                        await scope.assert.rejects(async function reportInvalidMapping() {
                            await generateCoverageReports({
                                ...fixture,
                                outputs: [],
                                sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                            });
                        }, { message: /Source map has no usable original mappings/u });
                    });
                    return scope.assert.collect();
                }
            });
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
