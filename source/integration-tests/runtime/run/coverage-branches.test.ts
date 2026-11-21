import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { table, suite } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { collectCoverageScript, withCoverageSources } from '../../../test-support/coverage-source-fixture.ts';
import { generateCoverageReports } from '../../../run/coverage-reporting.ts';

const branchCountsSchema = z.record(
    z.string(),
    z.object({
        b: z.record(z.string(), z.array(z.number()))
    })
);
const declarations = [
    {
        source:
            'const box = { function<Target>(value: Target): number { return value ? 10 : 20; } }; const choose = box.function;',
        title: 'generic method named function'
    },
    {
        source:
            'const box = { [["replace"][0]]<Target>(value: Target): number { return value ? 10 : 20; } }; const choose = box.replace;',
        title: 'nested computed generic method'
    },
    { source: 'const choose = (value: boolean): number => value ? 10 : 20;', title: 'typed arrow' },
    {
        source:
            'const box = { replace<Target>(value: Target): number { return value ? 10 : 20; } }; const choose = box.replace;',
        title: 'generic object method'
    },
    {
        source:
            'class Box { replace<Target>(value: Target): number { return value ? 10 : 20; } } const choose = new Box().replace;',
        title: 'generic class method'
    },
    {
        source:
            'const box = { async replace<Target>(value: Target): Promise<number> { return value ? 10 : 20; } }; const choose = box.replace;',
        title: 'async generic object method'
    },
    {
        source:
            'const box = { ["replace"]<Target>(value: Target): number { return value ? 10 : 20; } }; const choose = box.replace;',
        title: 'computed generic object method'
    },
    {
        source:
            'const box = { "replace"<Target>(value: Target): number { return value ? 10 : 20; } }; const choose = box.replace;',
        title: 'quoted generic object method'
    },
    {
        source:
            'const box = { replace: <Target>(value: Target): number => value ? 10 : 20 }; const choose = box.replace;',
        title: 'generic arrow property'
    },
    {
        source:
            'const box = { replace: function<Target>(value: Target): number { return value ? 10 : 20; } }; const choose = box.replace;',
        title: 'generic function property'
    }
];
const scenarios = [
    { calls: 'void choose;\n', counts: [ 0, 0 ], covered: 0, title: 'no calls' },
    { calls: 'choose(true);\nchoose(false);\n', counts: [ 1, 1 ], covered: 2, title: 'both arms' },
    { calls: 'choose(true);\nchoose(true);\nchoose(false);\n', counts: [ 2, 1 ], covered: 2, title: 'unequal counts' },
    { calls: 'choose(true);\n', counts: [ 1, 0 ], covered: 1, title: 'only the consequent' },
    { calls: 'choose(false);\n', counts: [ 0, 1 ], covered: 1, title: 'only the alternate' }
];
type ExpectedBranchReport = {
    readonly file: string;
    readonly counts: readonly number[];
};

const assertBranchReports = defineCompositeAssertion({
    name: 'branch reports',
    async assert(check, directory: string, expected: ExpectedBranchReport) {
        const json = branchCountsSchema.parse(JSON.parse(
            await readFile(
                path.join(directory, 'coverage-final.json'),
                'utf8'
            )
        ));
        const lcov = await readFile(path.join(directory, 'lcov.info'), 'utf8');
        return check.group([
            check.deepEqual(Object.keys(json), [ expected.file ]),
            check.deepEqual(
                Object.values(json).map(function branchCounts(entry) {
                    return entry.b;
                }),
                [ { 0: expected.counts } ]
            ),
            check.includes(lcov, 'DA:2,1\n'),
            check.deepEqual(
                Array.from(lcov.matchAll(/^BRDA:1,0,[01],(?<count>\d+)$/gmu), function branchCount(match) {
                    return Number(match.groups?.count);
                }),
                expected.counts
            )
        ]);
    }
});

export const testNode = suite(
    'Coverage branches',
    [ table({
        title: 'maps native TypeScript branches',
        cases: [ '.ts', '.mts', '.cts' ].flatMap(function nativeExtension(extension) {
            const cases = declarations.flatMap(function declarationScenarios(declaration) {
                return scenarios.map(function branchScenario(scenario) {
                    return { declaration, scenario };
                });
            });

            return cases.map(function branchScenarioTest({ declaration, scenario }) {
                return { extension, declaration, scenario };
            });
        }),
        caseTitle({ extension, declaration, scenario }) {
            return [ extension, declaration.title, scenario.title ].map(String).join(', ');
        },
        async test(scope) {
            const { extension, declaration, scenario } = scope.parameters;

            const file = `branch${extension}`;
            const source = `${declaration.source}\n${scenario.calls}`;

            await withCoverageSources(
                [ { file, loaded: false, source } ],
                async function verifyBranches(fixture) {
                    await collectCoverageScript(fixture, file);
                    const report = await generateCoverageReports({
                        ...fixture,
                        outputs: [ 'json', 'lcov' ],
                        sourceScope: { exclude: [], excludedFiles: new Set(), mode: 'loaded' }
                    });
                    await scope.assert(assertBranchReports, fixture.coverageDirectory, {
                        file,
                        counts: scenario.counts
                    });
                    scope.assert.deepEqual(report.summary.branches, { covered: scenario.covered, total: 2 });
                    scope.assert.deepEqual(report.summary.functions, {
                        covered: scenario.covered === 0 ? 0 : 1,
                        total: 1
                    });
                }
            );
            return scope.assert.collect();
        }
    }) ]
);
