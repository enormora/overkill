import { z } from 'zod/v4';
import { TestStatus, DryRunStatus, MutantRunStatus } from '@stryker-mutator/api/test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import { workIdentityKey, type PerTestResult, type RunnerError } from '../engine/engine.entry-point.ts';
import type { RunExecutionReply } from '../run/run.entry-point.ts';
import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { dryMutationResult, mutantExecutionResult } from './mutation-results.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
const root = '/project';

function firstTestResult(result: ResultReply['result']): PerTestResult {
    const first = result.perTest[0];
    if (first === undefined) {
        throw new Error('Missing native test fixture.');
    }
    return first;
}

function failedReply(
    errors: readonly RunnerError[],
    hitLimitExceeded: boolean,
    deadlineExceeded: boolean
): ResultReply {
    const result = runResultFactory.build({ perTest: [ { outcome: { kind: 'fail' } } ], runnerErrors: errors });
    const first = result.perTest[0];
    if (first === undefined) {
        throw new Error('Missing native test fixture.');
    }
    const id = workIdentityKey(first.workId);
    return {
        kind: 'result',
        result,
        deadlineExceeded,
        data: z.json().parse({
            catalog: [ {
                id,
                work: first.workId,
                annotations: { ownership: [], tags: [] },
                controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
                skipReason: null
            } ],
            selected: [ id ],
            completed: [ id ],
            bailed: false,
            coverage: { static: {}, perTest: {} },
            hitLimitExceeded
        })
    };
}

function includeIntentionalSkip(reply: ResultReply): ResultReply {
    const skipped = runResultFactory
        .build({
            perTest: [ {
                id: { ...firstTestResult(reply.result).id, title: 'intentionally skipped' },
                outcome: { kind: 'skip', reason: 'intentional' }
            } ]
        })
        .perTest[0];
    const data = mutationLifecycleDataSchema.parse(reply.data);
    const entry = data.catalog[0];
    if (skipped === undefined || entry === undefined) {
        throw new Error('Missing native skipped test fixture.');
    }
    const id = workIdentityKey(skipped.workId);
    return {
        ...reply,
        result: { ...reply.result, perTest: [ ...reply.result.perTest, skipped ] },
        data: {
            ...data,
            catalog: [ ...data.catalog, { ...entry, id, work: skipped.workId, skipReason: 'intentional' } ],
            selected: [ ...data.selected, id ],
            completed: [ ...data.completed, id ]
        }
    };
}

export const testNode = suite('Stryker result ownership', [
    test('excludes intentional skips from the number of executed mutant tests', function (scope) {
        const reply = includeIntentionalSkip(failedReply([], false, false));
        const mutant = mutantExecutionResult(root, reply);
        const dry = dryMutationResult(root, reply, 'off');
        if (mutant.status !== MutantRunStatus.Killed || dry.status !== DryRunStatus.Complete) {
            throw new Error('Expected a confirmed kill and complete dry run.');
        }
        scope.assert.equal(mutant.nrOfTests, 1);
        scope.assert.equal(mutant.killedBy.length, 1);
        scope.assert.equal(dry.tests[1]?.status, TestStatus.Skipped);
        return scope.assert.collect();
    }),
    test('preserves lifecycle failures when instrumentation also exceeded its hit limit', function (scope) {
        const reply = failedReply([], true, false);
        const result = mutantExecutionResult(root, {
            kind: 'failure',
            data: reply.data,
            failure: {
                kind: 'error',
                name: 'Error',
                message: 'Eligible test catalog changed under mutation.',
                cause: null,
                stack: null
            }
        });
        scope.assert.deepEqual(result, {
            status: MutantRunStatus.Error,
            errorMessage: 'Eligible test catalog changed under mutation.'
        });
        return scope.assert.collect();
    }),
    test('reports a confirmed assertion kill with its structural identity and actual count', function (scope) {
        const reply = failedReply([], false, false);
        const result = mutantExecutionResult(root, reply);
        if (result.status !== MutantRunStatus.Killed) {
            throw new Error('Expected a confirmed kill.');
        }
        scope.assert.equal(result.nrOfTests, 1);
        scope.assert.deepEqual(
            result.killedBy,
            reply.result.perTest.map(function (testCase) {
                return workIdentityKey(testCase.workId);
            })
        );
        return scope.assert.collect();
    }),
    test('keeps infrastructure errors ahead of kills and expired deadlines', function (scope) {
        const errors = runResultFactory
            .build({ runnerErrors: [ { subtype: 'reporter', message: 'delivery failed' } ] })
            .runnerErrors;
        const result = mutantExecutionResult(root, failedReply(errors, true, true));
        scope.assert.deepEqual(result, { status: 'error', errorMessage: 'delivery failed' });
        return scope.assert.collect();
    }),
    test('keeps tracked hit limits and deadlines ahead of kills', function (scope) {
        scope.assert.equal(mutantExecutionResult(root, failedReply([], true, false)).status, 'timeout');
        scope.assert.equal(mutantExecutionResult(root, failedReply([], false, true)).status, 'timeout');
        return scope.assert.collect();
    }),
    test('rejects cleanup failures even when the case also timed out', function (scope) {
        const reply = failedReply([], false, false);
        const first = reply.result.perTest[0];
        if (first === undefined) {
            throw new Error('Missing native test fixture.');
        }
        const outcome: PerTestResult['outcome'] = {
            kind: 'fail',
            failures: [
                { kind: 'timeout', deadlineMilliseconds: 1, elapsedMilliseconds: 2 },
                {
                    kind: 'cleanup-error',
                    error: { name: 'Error', message: 'cleanup failed', stack: null, thrown: null }
                }
            ]
        };
        const result = mutantExecutionResult(root, {
            ...reply,
            result: {
                ...reply.result,
                perTest: [ {
                    ...first,
                    outcome,
                    attempts: [ { ...first.attempts[0], outcome } ]
                } ]
            }
        });
        scope.assert.equal(result.status, 'error');
        return scope.assert.collect();
    }),
    test('requires child-local lifecycle observations before reporting a kill', function (scope) {
        const reply = failedReply([], false, false);
        const data = z.looseObject({ completed: z.array(z.string()) }).parse(reply.data);
        const result = mutantExecutionResult(root, { ...reply, data: z.json().parse({ ...data, completed: [] }) });
        scope.assert.equal(result.status, 'error');
        return scope.assert.collect();
    }),
    test('reports failed baseline tests without discarding their stable dry-run identity', function (scope) {
        const reply = failedReply([], false, false);
        const result = dryMutationResult(root, reply, 'off');
        if (result.status !== DryRunStatus.Complete) {
            throw new Error('Expected a complete dry run.');
        }
        const first = firstTestResult(reply.result);
        scope.assert.equal(result.tests[0]?.status, TestStatus.Failed);
        scope.assert.equal(result.tests[0]?.id, workIdentityKey(first.workId));
        scope.assert.equal(Object.hasOwn(result, 'mutantCoverage'), false);
        return scope.assert.collect();
    })
]);
