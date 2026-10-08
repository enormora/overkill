import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fromObject } from 'convert-source-map';
import * as typescript from 'typescript';
import { createCoverageTranspiler } from '../test-support/coverage-transpilation.ts';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    cacheCoverageSourceMap,
    collectCoverageScript,
    withCoverageSources,
    type CoverageSourceFixture
} from '../test-support/coverage-source-fixture.ts';
import { generateCoverageReports, type CoverageReportRequest } from './coverage-reporting.ts';

const transformCoverageFixture = createCoverageTranspiler(typescript);
const original = [
    'export function covered(): number {',
    '    return 42;',
    '}',
    'export function uncovered(): number {',
    '    return 7;',
    '}',
    'covered();',
    ''
]
    .join('\n');
const compiled = transformCoverageFixture(original, {
    filePath: 'src/value.ts',
    sourceMapOptions: { compiledFilename: 'generated/compiled.mjs' }
});
const map = { ...compiled.sourceMap, sources: [ '../src/value.ts' ], sourcesContent: [ original ] };
const mapStyles = [ 'cached', 'external', 'inline', 'indexed' ] as const;
type MapStyle = typeof mapStyles[number];

function mappedScript(style: MapStyle): string {
    if (style === 'inline') {
        return `${compiled.code}\n${fromObject(map).toComment()}\n`;
    }
    return style === 'external' || style === 'indexed'
        ? `${compiled.code}\n//# sourceMappingURL=../maps/compiled.map\n`
        : compiled.code;
}

async function assertOriginalCoverage(
    scope: TestScope,
    fixture: CoverageSourceFixture,
    sourceScope: CoverageReportRequest['sourceScope']
): Promise<void> {
    const report = await generateCoverageReports({ ...fixture, outputs: [ 'lcov' ], sourceScope });
    const lcov = await readFile(path.join(fixture.coverageDirectory, 'lcov.info'), 'utf8');

    scope.assert.includes(lcov, 'value.ts');
    scope.assert.false(lcov.includes('compiled.mjs'));
    scope.assert.includes(lcov, 'DA:2,1\n');
    scope.assert.includes(lcov, 'DA:5,0\n');
    scope.assert.equal(report.summary.functions.total, 2);
    scope.assert.equal(report.summary.functions.covered, 1);
}

const validMapTests = mapStyles.flatMap(function mapStyle(style) {
    return [ 'loaded', 'all' ].map(function sourceMode(mode) {
        return createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: `${mode} coverage resolves ${style} source maps before source selection`,
            async body(scope) {
                const data = style === 'indexed'
                    ? { version: 3, sections: [ { offset: { line: 0, column: 0 }, map } ] }
                    : map;

                await withCoverageSources([
                    { file: 'src/value.ts', loaded: false, source: original },
                    { file: 'generated/compiled.mjs', loaded: false, source: mappedScript(style) },
                    { file: 'maps/compiled.map', loaded: false, source: JSON.stringify(data) }
                ], async function verifyMap(fixture) {
                    await collectCoverageScript(fixture, 'generated/compiled.mjs');
                    if (style === 'cached') {
                        await cacheCoverageSourceMap(fixture, 'generated/compiled.mjs', map);
                    }
                    await assertOriginalCoverage(
                        scope,
                        fixture,
                        mode === 'all'
                            ? {
                                exclude: [ 'generated/**' ],
                                excludedFiles: new Set(),
                                include: [ 'src/**/*.ts' ],
                                mode
                            }
                            : { exclude: [ 'generated/**' ], excludedFiles: new Set(), mode: 'loaded' }
                    );
                });
                return scope.assert.collect();
            }
        });
    });
});

const invalidMaps = [
    {
        title: 'negative coordinates',
        script: mappedScript('external'),
        data: JSON.stringify({ ...map, mappings: 'D' })
    },
    {
        title: 'unmapped-only coordinates',
        script: mappedScript('external'),
        data: JSON.stringify({ ...map, mappings: 'A' })
    },
    { title: 'missing reference', script: `${compiled.code}\n//# sourceMappingURL=missing.map\n`, data: null },
    { title: 'malformed JSON', script: mappedScript('external'), data: '{' },
    { title: 'invalid mappings', script: mappedScript('external'), data: JSON.stringify({ ...map, mappings: '?' }) },
    { title: 'unusable mappings', script: mappedScript('external'), data: JSON.stringify({ ...map, mappings: '' }) },
    {
        title: 'invalid inline map',
        script: `${compiled.code}\n//# sourceMappingURL=data:application/json;base64,e30=\n`,
        data: null
    }
];

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-source-map.test.ts',
    children: [
        ...validMapTests,
        ...invalidMaps.map(function brokenMap(scenario) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `coverage rejects ${scenario.title} without falling back to JavaScript`,
                async body(scope) {
                    await withCoverageSources([
                        { file: 'src/value.ts', loaded: false, source: original },
                        { file: 'generated/compiled.mjs', loaded: true, source: scenario.script },
                        ...scenario.data === null
                            ? []
                            : [ { file: 'maps/compiled.map', loaded: false, source: scenario.data } ]
                    ], async function verifyFailure(fixture) {
                        await scope.assert.rejects(async function reportBrokenMap() {
                            await generateCoverageReports({
                                ...fixture,
                                outputs: [],
                                sourceScope: {
                                    exclude: [],
                                    excludedFiles: new Set(),
                                    include: [ 'src/**/*.ts' ],
                                    mode: 'all'
                                }
                            });
                        }, { message: /Coverage source map failed for .*compiled\.mjs/u });
                    });
                    return scope.assert.collect();
                }
            });
        }),
        createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'coverage ignores source-map declarations inside string literals',
            async body(scope) {
                await withCoverageSources([
                    {
                        file: 'value.mjs',
                        loaded: true,
                        source: 'export const text = `\n//# sourceMappingURL=missing.map\n`;\n'
                    }
                ], async function verifyJavaScript(fixture) {
                    const result = await generateCoverageReports({
                        ...fixture,
                        outputs: [],
                        sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                    });

                    scope.assert.true(result.summary.lines.total > 0);
                });
                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
