import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createSuite, createTestCase } from '../packages/engine/engine.entry-point.ts';
import { withCoverageSources } from '../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from './coverage-reporting.ts';

const typeOnlySources = [
    '/** Domain value. */\nexport type Value = { value: number };\n',
    '// Domain contract.\nexport interface Value { value: number; }\n',
    'import type { Value } from "./types.ts";\nexport type Other = Value;\n',
    'export {}; // Module marker.\n',
    ';\n/* Module marker. */ export {};\n',
    'export declare const value: number;\n'
];

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-type-only.test.ts',
    children: [ 'all', 'loaded' ].map(function sourceMode(mode) {
        return createTestCase({
            annotations: {},
            controls: {},
            definitionLocations: [ { kind: 'unknown' } ],
            title: `${mode} coverage ignores commented type-only sources and preserves executable imports`,
            async body(scope) {
                await withCoverageSources([
                    ...typeOnlySources.map(function typeOnlySource(source, index) {
                        return { file: `types-${index}.ts`, loaded: mode === 'loaded', source };
                    }),
                    { file: 'value.ts', loaded: true, source: 'export const value = 42;\n' },
                    { file: 'side-effect.ts', loaded: true, source: 'import "./value.ts";\n' }
                ], async function verifySources(fixture) {
                    const report = await generateCoverageReports({
                        ...fixture,
                        outputs: [ 'lcov' ],
                        sourceScope: mode === 'all'
                            ? { exclude: [], excludedFiles: new Set(), include: [ '*.ts' ], mode }
                            : { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                    });
                    const lcov = await readFile(path.join(fixture.coverageDirectory, 'lcov.info'), 'utf8');

                    scope.assert.false(lcov.includes('types-'));
                    scope.assert.includes(lcov, 'value.ts');
                    scope.assert.includes(lcov, 'side-effect.ts');
                    scope.assert.equal(report.summary.lines.total, 2);
                    scope.assert.equal(report.summary.lines.covered, 2);
                });

                return scope.assert.collect();
            }
        });
    })
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
