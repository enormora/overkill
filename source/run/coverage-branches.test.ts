import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { collectCoverageScript, withCoverageSources } from '../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from './coverage-reporting.ts';

const branchCountsSchema = z.record(
    z.string(),
    z.object({
        b: z.record(z.string(), z.array(z.number()))
    })
);
const scenarios = [
    { calls: 'choose(true);\nchoose(false);\n', counts: [ 1, 1 ], covered: 2, title: 'both arms' },
    { calls: 'choose(true);\nchoose(true);\nchoose(false);\n', counts: [ 2, 1 ], covered: 2, title: 'unequal counts' },
    { calls: 'choose(true);\n', counts: [ 1, 0 ], covered: 1, title: 'only the consequent' },
    { calls: 'choose(false);\n', counts: [ 0, 1 ], covered: 1, title: 'only the alternate' }
];
type ExpectedBranchReport = {
    readonly file: string;
    readonly counts: readonly number[];
};

async function assertBranchReports(
    scope: TestScope,
    directory: string,
    expected: ExpectedBranchReport
): Promise<void> {
    const json = branchCountsSchema.parse(JSON.parse(
        await readFile(
            path.join(directory, 'coverage-final.json'),
            'utf8'
        )
    ));
    const lcov = await readFile(path.join(directory, 'lcov.info'), 'utf8');

    scope.assert.deepEqual(Object.keys(json), [ expected.file ]);
    scope.assert.deepEqual(
        Object.values(json).map(function branchCounts(entry) {
            return entry.b;
        }),
        [ { 0: expected.counts } ]
    );
    scope.assert.includes(lcov, 'DA:2,1\n');
    scope.assert.deepEqual(
        Array.from(lcov.matchAll(/^BRDA:1,0,[01],(?<count>\d+)$/gmu), function branchCount(match) {
            return Number(match.groups?.count);
        }),
        expected.counts
    );
}

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/run/coverage-branches.test.ts',
    children: [ '.ts', '.mts', '.cts' ].flatMap(function nativeExtension(extension) {
        return scenarios.map(function branchScenario(scenario) {
            return createTestCase({
                annotations: {},
                controls: {},
                definitionLocations: [ { kind: 'unknown' } ],
                title: `native ${extension} coverage maps typed arrow branches for ${scenario.title}`,
                async body(scope) {
                    const file = `branch${extension}`;
                    const source = `const choose = (value: boolean): number => value ? 10 : 20;\n${scenario.calls}`;

                    await withCoverageSources(
                        [ { file, loaded: false, source } ],
                        async function verifyBranches(fixture) {
                            await collectCoverageScript(fixture, file);
                            const report = await generateCoverageReports({
                                ...fixture,
                                outputs: [ 'json', 'lcov' ],
                                sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                            });
                            await assertBranchReports(scope, fixture.coverageDirectory, {
                                file,
                                counts: scenario.counts
                            });
                            scope.assert.deepEqual(report.summary.branches, { covered: scenario.covered, total: 2 });
                            scope.assert.deepEqual(report.summary.functions, { covered: 1, total: 1 });
                        }
                    );
                    return scope.assert.collect();
                }
            });
        });
    })
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
