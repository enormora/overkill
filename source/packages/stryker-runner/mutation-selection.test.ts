import { suite, test } from '../test/test.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { planMutantInvocation } from './mutation-selection.ts';

export const testNode = suite('mutation coverage selection', [
    test('rejects a fallback catalog with no runnable cases', function (scope) {
        const { baseline, options } = mutationCoverageFixture('perTest');
        const campaign = {
            ...baseline,
            catalog: baseline.catalog.map(function intentionalSkip(entry) {
                return { ...entry, skipReason: 'intentional' };
            })
        };
        scope.assert.throws(function skippedSelection() {
            planMutantInvocation({ root: '/project', campaign, input: options, ignoreStatic: false });
        }, { message: 'Stryker requested a mutant selection with no runnable tests.' });
        return scope.assert.collect();
    }),
    test('narrows only when the requested cases contain every positive coverage owner', function (scope) {
        const { baseline, options } = mutationCoverageFixture('perTest');
        const covering = Object.keys(baseline.coverage.perTest);
        scope.assert.deepEqual(
            planMutantInvocation({
                root: '/project',
                campaign: baseline,
                input: { ...options, testFilter: covering },
                ignoreStatic: false
            }),
            { mode: 'runtime', selected: covering }
        );
        scope.assert.deepEqual(
            planMutantInvocation({
                root: '/project',
                campaign: baseline,
                input: { ...options, testFilter: [ 'first.test.ts', '/project/second.test.ts' ] },
                ignoreStatic: false
            }),
            { mode: 'runtime', selected: covering }
        );
        return scope.assert.collect();
    }),
    ...([ 'all', 'off', 'perTest' ] as const).map(function coverageMode(coverageAnalysis) {
        return test(`${coverageAnalysis} widens unsupported attribution to the frozen catalog`, function (scope) {
            const { baseline, options } = mutationCoverageFixture(coverageAnalysis);
            const complete = baseline.catalog.map(function testIdentity(entry) {
                return entry.id;
            });
            for (
                const input of [
                    options,
                    { ...options, testFilter: complete.slice(0, 1) },
                    { ...options, testFilter: complete.slice(2) }
                ]
            ) {
                scope.assert.deepEqual(
                    planMutantInvocation({
                        root: '/project',
                        campaign: baseline,
                        input,
                        ignoreStatic: false
                    }),
                    { mode: 'runtime', selected: complete }
                );
            }
            scope.assert.deepEqual(
                planMutantInvocation({
                    root: '/project',
                    campaign: { ...baseline, coverage: { static: {}, perTest: {} } },
                    input: { ...options, testFilter: complete.slice(0, 1) },
                    ignoreStatic: false
                }),
                { mode: 'runtime', selected: complete }
            );
            return scope.assert.collect();
        });
    }),
    test('all and off widen even filters supported by raw per-case evidence', function (scope) {
        for (const mode of [ 'all', 'off' ] as const) {
            const { baseline, options } = mutationCoverageFixture(mode);
            const invocation = planMutantInvocation({
                root: '/project',
                campaign: baseline,
                input: { ...options, testFilter: Object.keys(baseline.coverage.perTest) },
                ignoreStatic: false
            });
            scope.assert.deepEqual(
                invocation.selected,
                baseline.catalog.map(function testIdentity(entry) {
                    return entry.id;
                })
            );
        }
        return scope.assert.collect();
    }),
    test('zero counts establish neither static activation nor safe narrowing', function (scope) {
        const { baseline, options } = mutationCoverageFixture('perTest');
        const selected = baseline.catalog.slice(0, 1).map(function testIdentity(entry) {
            return entry.id;
        });
        const campaign = {
            ...baseline,
            coverage: {
                static: { mutant: 0 },
                perTest: Object.fromEntries(selected.map(function zeroCoverageCase(id) {
                    return [ id, { mutant: 0 } ];
                }))
            }
        };
        scope.assert.deepEqual(
            planMutantInvocation({
                root: '/project',
                campaign,
                input: { ...options, testFilter: selected },
                ignoreStatic: false
            }),
            {
                mode: 'runtime',
                selected: baseline.catalog.map(function testIdentity(entry) {
                    return entry.id;
                })
            }
        );
        return scope.assert.collect();
    }),
    test('static and hybrid coverage require the full catalog unless explicitly ignored', function (scope) {
        const { baseline, options } = mutationCoverageFixture('perTest');
        const campaign = { ...baseline, coverage: { ...baseline.coverage, static: { mutant: 2 } } };
        const covering = Object.keys(baseline.coverage.perTest);
        const input = { ...options, testFilter: covering };
        const complete = baseline.catalog.map(function testIdentity(entry) {
            return entry.id;
        });
        scope.assert.deepEqual(planMutantInvocation({ root: '/project', campaign, input, ignoreStatic: false }), {
            mode: 'static',
            selected: complete
        });
        scope.assert.deepEqual(planMutantInvocation({ root: '/project', campaign, input, ignoreStatic: true }), {
            mode: 'runtime',
            selected: covering
        });
        scope.assert.deepEqual(
            planMutantInvocation({
                root: '/project',
                campaign,
                input: { ...input, mutantActivation: 'static' },
                ignoreStatic: true
            }),
            { mode: 'static', selected: complete }
        );
        return scope.assert.collect();
    }),
    test('rejects invalid filters before static or full-suite fallback', function (scope) {
        for (const mode of [ 'all', 'off', 'perTest' ] as const) {
            const { baseline, options } = mutationCoverageFixture(mode);
            for (const testFilter of [ [], [ 'unknown' ], [ 'first.test.ts', 'first.test.ts' ] ]) {
                scope.assert.throws(function planInvalidFilter() {
                    planMutantInvocation({
                        root: '/project',
                        campaign: baseline,
                        input: { ...options, testFilter, mutantActivation: 'static' },
                        ignoreStatic: false
                    });
                }, { message: /Stryker requested/u });
            }
        }
        return scope.assert.collect();
    })
]);
