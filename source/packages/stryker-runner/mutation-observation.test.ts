import { suite, test } from '../test/test.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { mutantExecutionResult } from './mutation-results.ts';
import { dryMutationResult } from './dry-run-results.ts';
import type { MutationInvocationExpectation } from './mutation-observation.ts';

export const testNode = suite('mutation invocation observations', [
    test('rejects jointly shortened selection and results against the caller request', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const expectation: MutationInvocationExpectation = {
            kind: 'mutant',
            baseline,
            selected: data.selected,
            disableBail: true
        };
        const result = mutantExecutionResult('/project', {
            ...reply,
            result: { ...reply.result, perTest: reply.result.perTest.slice(0, 1) },
            data: { ...data, selected: data.selected.slice(0, 1), completed: data.completed.slice(0, 1) }
        }, expectation);
        scope.assert.equal(result.status, 'error');
        return scope.assert.collect();
    }),
    test('rejects changed selection metadata even when all identities are unchanged', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        for (const field of [ 'annotations', 'controls', 'skipReason' ]) {
            const catalog = data.catalog.map(function changedMetadata(entry) {
                return {
                    ...entry,
                    annotations: field === 'annotations' ? { ownership: [], tags: [ 'changed' ] } : entry.annotations,
                    controls: field === 'controls' ? { ...entry.controls, timeoutMilliseconds: 1 } : entry.controls,
                    skipReason: field === 'skipReason' ? 'changed' : entry.skipReason
                };
            });
            scope.assert.equal(
                mutantExecutionResult('/project', { ...reply, data: { ...data, catalog } }, {
                    kind: 'mutant',
                    baseline,
                    selected: data.selected,
                    disableBail: true
                })
                    .status,
                'error'
            );
        }
        return scope.assert.collect();
    }),
    test('rejects extra, duplicate, missing, and mismatched completions', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const invalidCompletions = [
            [],
            [ ...data.completed, 'unknown' ],
            data.completed.toReversed(),
            [ ...data.completed, ...data.completed ]
        ];
        for (const completed of invalidCompletions) {
            scope.assert.equal(
                mutantExecutionResult('/project', { ...reply, data: { ...data, completed } }, {
                    kind: 'mutant',
                    baseline,
                    selected: data.selected,
                    disableBail: true
                })
                    .status,
                'error'
            );
        }
        return scope.assert.collect();
    }),
    test('rejects an unexpected skip without changing the collected catalog', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const perTest = reply.result.perTest.map(function unexpectedSkip(result) {
            return { ...result, verdict: 'skip' as const, outcome: { kind: 'skip' as const, reason: 'changed' } };
        });
        scope.assert.equal(
            mutantExecutionResult('/project', {
                ...reply,
                result: { ...reply.result, perTest }
            }, { kind: 'mutant', baseline, selected: data.selected, disableBail: true })
                .status,
            'error'
        );
        return scope.assert.collect();
    }),
    test('rejects a shortened initial dry catalog against the native planned count', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        scope.assert.equal(
            dryMutationResult(
                '/project',
                {
                    ...reply,
                    result: { ...reply.result, perTest: reply.result.perTest.slice(0, 1) },
                    data: {
                        ...data,
                        catalog: data
                            .catalog
                            .slice(0, 1),
                        selected: data.selected.slice(0, 1),
                        completed: data.completed.slice(0, 1),
                        coverage: { static: {}, perTest: {} }
                    }
                },
                'perTest',
                { kind: 'dry', baseline: null, testFiles: null }
            )
                .status,
            'error'
        );
        return scope.assert.collect();
    }),
    test('accepts partial completion only for an allowed confirmed kill', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const first = reply.result.perTest[0];
        if (first === undefined) {
            throw new Error('Missing mutation case fixture.');
        }
        const failed = runResultFactory
            .build({
                perTest: [ { id: first.id, workId: first.workId, outcome: { kind: 'fail' } } ]
            })
            .perTest;
        const partial = {
            ...reply,
            result: { ...reply.result, perTest: failed },
            data: {
                ...data,
                completed: data.completed.slice(0, 1),
                coverage: { static: {}, perTest: {} },
                bailed: true
            }
        };
        for (const disableBail of [ false, true ]) {
            scope.assert.equal(
                mutantExecutionResult('/project', partial, {
                    kind: 'mutant',
                    baseline,
                    selected: data.selected,
                    disableBail
                })
                    .status,
                disableBail ? 'error' : 'killed'
            );
        }
        return scope.assert.collect();
    }),
    test('rejects bail without a confirmed failure', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        scope.assert.equal(
            mutantExecutionResult('/project', {
                ...reply,
                result: { ...reply.result, perTest: reply.result.perTest.slice(0, 1) },
                data: {
                    ...data,
                    completed: data.completed.slice(0, 1),
                    coverage: { static: {}, perTest: {} },
                    bailed: true
                }
            }, { kind: 'mutant', baseline, selected: data.selected, disableBail: false })
                .status,
            'error'
        );
        return scope.assert.collect();
    })
]);
