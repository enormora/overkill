import { resolve } from 'node:path';
import { suite, test } from '../test/test.entry-point.ts';
import { workIdentityKey, type CollectedRunPlan, type WorkId } from '../run/run.entry-point.ts';
import { runIfMain } from '../../test-support/run-if-main.ts';
import {
    canonicalWork,
    eligibleMutationCatalog,
    exactMutationSelection,
    mutationCatalog,
    projectFile
} from './mutation-catalog.ts';

const root = resolve('/sandbox');
const definitionLocations = [ { kind: 'unknown' } ] as const;
const annotations = { ownership: [], tags: [] };
const controls = { capture: null, duplicateExecution: null, timeoutMilliseconds: null };
const work: WorkId = {
    case: { file: 'tests/a.ts', suite: [ 'suite' ], title: 'case', params: null },
    runtimes: [],
    workload: null
};

function collectedWorkPlan(works: readonly WorkId[]): CollectedRunPlan {
    const files = Array.from(
        Map.groupBy(works, function caseFile(entry) {
            return entry.case.file ?? '';
        }),
        function collectedFile([ file, entries ]) {
            return {
                file,
                cases: entries.map(function collectedCase(entry) {
                    return {
                        annotations,
                        controls,
                        definitionLocations,
                        params: entry.case.params,
                        property: null,
                        benchmark: null,
                        workloadParameters: null,
                        resourceAttachments: { directResources: [], resourceGraph: [], runtimeGraphs: [] },
                        skipReason: null,
                        suitePath: entry.case.suite.map(function suiteEntry(title) {
                            return { title, definitionLocations };
                        }),
                        testFamily: 'microtest' as const,
                        title: entry.case.title,
                        workId: entry
                    };
                })
            };
        }
    );
    return {
        defined: works.length,
        discoveredFiles: files,
        files,
        orphans: [],
        root: {
            annotations,
            controls,
            title: 'catalog'
        }
    };
}

export const testNode = suite('mutation test identities', [
    test('canonicalizes origin aliases independently of the sandbox location', function (scope) {
        for (const sandbox of [ root, resolve('/replacement') ]) {
            for (
                const file of [
                    'tests/a.ts',
                    './tests/a.ts',
                    'tests//a.ts',
                    'tests/nested/../a.ts',
                    'tests\\nested\\..\\a.ts',
                    resolve(sandbox, 'tests/a.ts')
                ]
            ) {
                const plan = collectedWorkPlan([ { ...work, case: { ...work.case, file } } ]);
                const catalog = eligibleMutationCatalog(sandbox, plan, [ './tests/nested/../a.ts' ]);
                scope.assert.equal(projectFile(sandbox, file), 'tests/a.ts');
                scope.assert.deepEqual(
                    catalog.map(function identity(entry) {
                        return entry.id;
                    }),
                    [ '["tests/a.ts",["suite"],"case",null]' ]
                );
            }
        }
        return scope.assert.collect();
    }),
    test('rejects origins outside the sandbox and origins naming its root', function (scope) {
        for (
            const file of [
                '../outside.ts',
                'tests/../../outside.ts',
                'tests\\..\\..\\outside.ts',
                resolve(root, '../sandbox-other/a.ts'),
                '',
                '.',
                'tests/..',
                root
            ]
        ) {
            scope.assert.throws(function rejectInvalidOrigin() {
                projectFile(root, file);
            }, { message: /mutation sandbox/u });
        }
        return scope.assert.collect();
    }),
    test('distinguishes structural paths and parameter keys with identical rendered names', function (scope) {
        const cases = [
            { ...work, case: { ...work.case, suite: [ 'outer > inner' ] } },
            { ...work, case: { ...work.case, suite: [ 'outer', 'inner' ] } }
        ];
        const catalog = mutationCatalog(root, collectedWorkPlan(cases));
        const identities = new Set(catalog.map(function identity(entry) {
            return entry.id;
        }));
        scope.assert.equal(identities.size, 2);
        const parameterized = [ null, '', '"one"', '"two"' ].map(function parameterKey(params) {
            return mutationCatalog(root, collectedWorkPlan([ { ...work, case: { ...work.case, params } } ]))[0]?.id;
        });
        const parameterIdentities = new Set(parameterized);
        scope.assert.equal(parameterIdentities.size, 4);
        scope.assert.deepEqual(canonicalWork(root, { ...work, case: { ...work.case, file: null } }), {
            ...work,
            case: { ...work.case, file: null }
        });
        return scope.assert.collect();
    }),
    test('retains runtime variants and selects the original work after origin normalization', function (scope) {
        const variants = [ 'first', 'second' ].map(function runtimeVariant(variantId): WorkId {
            return {
                ...work,
                case: { ...work.case, file: './tests/a.ts' },
                runtimes: [ {
                    name: 'node',
                    variantId,
                    dimensions: { node: '26', module: 'esm' },
                    scenarios: {}
                } ]
            };
        });
        const plan = collectedWorkPlan(variants);
        const catalog = mutationCatalog(root, plan);
        scope.assert.equal(catalog.length, 2);
        scope.assert.notEqual(catalog[0]?.id, catalog[1]?.id);
        for (const variant of variants) {
            const id = workIdentityKey(canonicalWork(root, variant));
            scope.assert.deepEqual(exactMutationSelection(root, plan, [ id ]), {
                kind: 'filter',
                filter: { kind: 'any', filters: [ { kind: 'work-id', id: variant } ] }
            });
        }
        return scope.assert.collect();
    }),
    test('ignores runtime record insertion order', function (scope) {
        const first: WorkId = {
            ...work,
            runtimes: [ {
                name: 'node',
                variantId: null,
                dimensions: { node: '26', module: 'esm' },
                scenarios: { api: 'default', database: 'empty' }
            } ]
        };
        const reordered = {
            ...first,
            runtimes: first.runtimes.map(function reorderedRecords(runtime) {
                return {
                    ...runtime,
                    dimensions: { module: 'esm', node: '26' },
                    scenarios: { database: 'empty', api: 'default' }
                };
            })
        };
        scope.assert.deepEqual(
            mutationCatalog(root, collectedWorkPlan([ reordered ])),
            mutationCatalog(root, collectedWorkPlan([ first ]))
        );
        return scope.assert.collect();
    }),
    test('ignores source positions while rejecting duplicate canonical work', function (scope) {
        const plan = collectedWorkPlan([ work ]);
        const moved: CollectedRunPlan = {
            ...plan,
            files: plan.files.map(function movedFile(file) {
                return {
                    ...file,
                    cases: file.cases.map(function movedCase(testCase) {
                        return {
                            ...testCase,
                            definitionLocations: [ {
                                kind: 'known' as const,
                                file: 'tests/a.ts',
                                line: 200,
                                column: 30
                            } ],
                            suitePath: testCase.suitePath.map(function movedSuite(entry) {
                                return {
                                    ...entry,
                                    definitionLocations: [ {
                                        kind: 'known' as const,
                                        file: 'tests/a.ts',
                                        line: 100,
                                        column: 20
                                    } ] as const
                                };
                            })
                        };
                    })
                };
            })
        };
        scope.assert.deepEqual(mutationCatalog(root, moved), mutationCatalog(root, plan));
        scope.assert.throws(function rejectCanonicalDuplicate() {
            mutationCatalog(
                root,
                collectedWorkPlan([ work, { ...work, case: { ...work.case, file: './tests/a.ts' } } ])
            );
        }, { message: 'Mutation catalog must contain unique eligible tests.' });
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
