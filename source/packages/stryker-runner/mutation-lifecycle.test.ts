import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { z } from 'zod/v4';

import { workIdentityKey, type PerTestResult } from '../run/run.entry-point.ts';
import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { collectedMutationPlan } from '../../test-support/mutation-plan-fixture.ts';
import { createMutationLifecycle } from './mutation-lifecycle.ts';
import { eligibleMutationCatalog } from './mutation-catalog.ts';

const root = '/project';
const input = {
    root,
    mode: 'dry',
    activeMutant: null,
    hitLimit: null,
    baseline: null,
    selected: null,
    disableBail: true,
    files: null
};

function mutationCaseResults(): readonly [PerTestResult, PerTestResult] {
    const [ first, second ] = runResultFactory
        .build({
            perTest: [
                { id: { file: 'case.ts', suite: [], title: 'first', params: null } },
                { id: { file: 'case.ts', suite: [], title: 'second', params: null } }
            ]
        })
        .perTest;
    if (first === undefined || second === undefined) {
        throw new Error('Missing mutation case fixtures.');
    }
    return [ first, second ];
}

function failedMutationCase(): PerTestResult {
    const [ original ] = mutationCaseResults();
    const outcome: NonNullable<PerTestResult['outcome']> = {
        kind: 'fail',
        failures: [ { kind: 'body-error', error: { name: 'Error', message: 'failed', stack: null, thrown: null } } ]
    };
    return {
        ...original,
        verdict: 'fail',
        outcome,
        attempts: [ { ...original.attempts[0], verdict: 'fail', outcome } ]
    };
}
export const testNode: TestNode = suite('mutation case admission', [
    test('rejects admission and completion before selection', async function (scope) {
        const [ result ] = mutationCaseResults();
        const lifecycle = await createMutationLifecycle(input);
        scope.cleanup(lifecycle.dispose);
        await scope.assert.rejects(async function () {
            await lifecycle.enterCase(result.workId);
        }, { message: /unselected or repeated/u });
        await scope.assert.rejects(async function () {
            await lifecycle.completeCase(result, []);
        }, { message: /active admission/u });
        scope.assert.partialDeepEqual<unknown, unknown>(lifecycle.snapshot(), {
            catalog: [],
            selected: [],
            completed: [],
            bailed: false
        });
        return scope.assert.collect();
    }),
    table({
        title: 'classifies failed adapter results across bail policies',
        cases: [ 'dry', 'runtime', 'static' ].flatMap(function (mode) {
            return [ false, true ].map(function (disableBail) {
                return { mode, disableBail };
            });
        }),
        caseTitle({ mode, disableBail }) {
            return [ mode, disableBail ].map(String).join(', ');
        },
        async test(scope) {
            const result = failedMutationCase();
            const lifecycle = await createMutationLifecycle({
                ...input,
                mode: scope.parameters.mode,
                disableBail: scope.parameters.disableBail,
                activeMutant: '1',
                hitLimit: 1
            });
            scope.cleanup(lifecycle.dispose);
            await lifecycle.select(collectedMutationPlan([ result.workId ]));
            await lifecycle.beforeCases();
            await lifecycle.enterCase(result.workId);
            const stopped = await lifecycle.completeCase(result, []);
            scope.assert.equal(
                stopped,
                scope.parameters.mode !== 'dry' && !scope.parameters.disableBail ? 'stop' : 'continue'
            );
            scope.assert.partialDeepEqual<unknown, unknown>(lifecycle.snapshot(), {
                completed: [ workIdentityKey(result.workId) ],
                bailed: stopped === 'stop'
            });
            return scope.assert.collect();
        }
    }),
    test('rejects unknown identities and empty runtime selections', async function (scope) {
        const [ result ] = mutationCaseResults();
        const unknown = await createMutationLifecycle({ ...input, selected: [ 'missing' ] });
        scope.cleanup(unknown.dispose);
        await scope.assert.rejects(async function () {
            await unknown.select(collectedMutationPlan([ result.workId ]));
        }, { message: 'Stryker requested an unknown test identity.' });
        const empty = await createMutationLifecycle({ ...input, mode: 'runtime', selected: [] });
        scope.cleanup(empty.dispose);
        await scope.assert.rejects(async function () {
            await empty.select(collectedMutationPlan([ result.workId ]));
        }, { message: 'Stryker requested a mutant selection with no runnable tests.' });
        return scope.assert.collect();
    }),
    test('rejects admissions outside selection and repeated admissions', async function (scope) {
        const [ first, second ] = mutationCaseResults();
        const lifecycle = await createMutationLifecycle({ ...input, selected: [ workIdentityKey(first.workId) ] });
        scope.cleanup(lifecycle.dispose);
        await lifecycle.select(collectedMutationPlan([ first.workId, second.workId ]));
        await scope.assert.rejects(async function unselectedAdmission() {
            await lifecycle.enterCase(second.workId);
        }, { message: /unselected or repeated/u });
        await lifecycle.enterCase(first.workId);
        await scope.assert.rejects(async function overlappingAdmission() {
            await lifecycle.enterCase(first.workId);
        }, { message: /exclusive serial/u });
        await lifecycle.completeCase(first, []);
        await scope.assert.rejects(async function repeatedAdmission() {
            await lifecycle.enterCase(first.workId);
        }, { message: /unselected or repeated/u });
        return scope.assert.collect();
    }),
    test('rejects repeated completions', async function (scope) {
        const [ result ] = mutationCaseResults();
        const lifecycle = await createMutationLifecycle(input);
        scope.cleanup(lifecycle.dispose);
        await lifecycle.select(collectedMutationPlan([ result.workId ]));
        await lifecycle.enterCase(result.workId);
        await lifecycle.completeCase(result, []);
        await scope.assert.rejects(async function repeatedCompletion() {
            await lifecycle.completeCase(result, []);
        }, { message: /active admission/u });
        return scope.assert.collect();
    }),
    test(
        'rejects completion without admission and changed intentional skips',
        async function (scope) {
            const [ original ] = mutationCaseResults();
            const result: PerTestResult = {
                ...original,
                verdict: 'skip',
                outcome: { kind: 'skip', reason: 'original' }
            };
            const lifecycle = await createMutationLifecycle(input);
            scope.cleanup(lifecycle.dispose);
            const plan = collectedMutationPlan([ result.workId ]);
            await lifecycle.select({
                ...plan,
                files: plan.files.map(function skippedFile(file) {
                    return {
                        ...file,
                        cases: file.cases.map(function skippedCase(entry) {
                            return { ...entry, skipReason: 'original' };
                        })
                    };
                })
            });
            await scope.assert.rejects(async function missingAdmission() {
                await lifecycle.completeCase(result, []);
            }, { message: /active admission/u });
            await lifecycle.enterCase(result.workId);
            await scope.assert.rejects(async function changedSkip() {
                await lifecycle.completeCase({ ...result, outcome: { kind: 'skip', reason: 'changed' } }, []);
            }, { message: /intentional skip state/u });
            return scope.assert.collect();
        }
    ),
    test(
        'detects added cases in originally empty eligible files before selection',
        async function (scope) {
            const result = runResultFactory
                .build({ perTest: [ { id: { file: 'case.ts', suite: [], title: 'original', params: null } } ] })
                .perTest[0];
            if (result === undefined) {
                throw new Error('Missing mutation case fixture.');
            }
            const original = collectedMutationPlan([
                result.workId
            ]);
            const lifecycle = await createMutationLifecycle(
                z.json().parse({
                    ...input,
                    mode: 'runtime',
                    baseline: eligibleMutationCatalog(root, original, null).catalog,
                    files: [ 'case.ts', 'empty.ts' ],
                    selected: [ workIdentityKey(result.workId) ]
                })
            );
            scope.cleanup(lifecycle.dispose);
            await scope.assert.rejects(async function addedCase() {
                await lifecycle.select(collectedMutationPlan([
                    result.workId,
                    { ...result.workId, case: { ...result.workId.case, file: 'empty.ts' } }
                ]));
            }, { message: 'Eligible test catalog changed under mutation.' });
            return scope.assert.collect();
        }
    )
]);
