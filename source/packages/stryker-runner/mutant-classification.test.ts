import { MutantRunStatus, type MutantRunResult } from '@stryker-mutator/api/test-runner';
import { testNode as executionTestNode } from '../../integration-tests/run/runner-stryker-classification.test.ts';
import { suite, test } from '../test/test.entry-point.ts';
import { workIdentityKey, type PerTestResult, type RunnerError } from '../run/run.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { mutantExecutionResult } from './mutation-results.ts';
import { classifyMutationCase } from './mutation-case-classification.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';

type Outcome = PerTestResult['outcome'];
const root = '/project';
const bodyFailure = {
    kind: 'body-error',
    error: { name: 'Error', message: 'body sentinel', stack: null, thrown: null }
} as const;
const cleanupFailure = {
    kind: 'cleanup-error',
    error: { name: 'Error', message: 'cleanup sentinel', stack: null, thrown: null }
} as const;

function caseResult(outcome: Outcome, verdict: PerTestResult['verdict']): PerTestResult {
    const result = mutationCoverageFixture('off').reply.result.perTest[0];
    if (result === undefined) {
        throw new Error('Missing mutation case fixture.');
    }
    return { ...result, outcome, verdict, attempts: [ { ...result.attempts[0], outcome, verdict } ] };
}

function policyError(result: PerTestResult, subtype: RunnerError['subtype']): RunnerError {
    return {
        subtype,
        attributedTo: result.id,
        attributedToWork: result.workId,
        attributedToAttempt: { index: 0 },
        cause: { phase: 'body', capability: 'console', reason: 'policy sentinel' },
        diagnostics: [],
        message: 'policy sentinel'
    };
}

function translate(result: PerTestResult, errors: readonly RunnerError[]): MutantRunResult {
    const { reply, baseline } = mutationCoverageFixture('off');
    return mutantExecutionResult(root, {
        ...reply,
        result: { ...reply.result, perTest: [ result, ...reply.result.perTest.slice(1) ], runnerErrors: errors }
    }, {
        kind: 'mutant',
        baseline,
        selected: baseline.catalog.map(function selectedIdentity(entry) {
            return entry.id;
        }),
        disableBail: true
    });
}

export const testNode = suite('mutant case classification', [
    executionTestNode,
    ...([ 'runtime-policy', 'permission', 'uncaught-exception', 'unhandled-rejection' ] as const).map(
        function policy(subtype) {
            return test(`kills safely attributed ${subtype} failures with structured diagnostics`, function (scope) {
                const verdict = subtype === 'runtime-policy' || subtype === 'permission' ? 'runtime-policy' : 'crashed';
                const result = caseResult(null, verdict);
                const mutant = translate(result, [ policyError(result, subtype) ]);
                if (mutant.status !== MutantRunStatus.Killed) {
                    throw new Error('Expected a safely attributed policy kill.');
                }
                scope.assert.deepEqual(mutant.killedBy, [ workIdentityKey(result.workId) ]);
                scope.assert.equal(mutant.nrOfTests, 3);
                scope.assert.true(mutant.failureMessage.includes('policy sentinel'));
                scope.assert.true(mutant.failureMessage.includes(workIdentityKey(result.workId)));
                return scope.assert.collect();
            });
        }
    ),
    ...([ 'artifact', 'reporter', 'loader', 'crash', 'process-exhaustion', 'attribution-drift' ] as const).map(
        function infrastructure(subtype) {
            return test(`keeps attributed ${subtype} failures as errors alongside a body failure`, function (scope) {
                const result = caseResult({ kind: 'fail', failures: [ bodyFailure ] }, 'fail');
                scope.assert.equal(translate(result, [ policyError(result, subtype) ]).status, 'error');
                return scope.assert.collect();
            });
        }
    ),
    test('rejects missing, stale, and conflicting policy attribution', function (scope) {
        const result = caseResult(null, 'runtime-policy');
        const error = policyError(result, 'permission');
        const invalid: readonly RunnerError[] = [
            { ...error, attributedTo: null },
            { ...error, attributedToWork: null },
            { ...error, attributedToAttempt: null },
            { ...error, attributedToAttempt: { index: 1 } },
            { ...error, attributedTo: { ...result.id, title: 'another case' } },
            { ...error, attributedToWork: { ...result.workId, case: { ...result.id, title: 'another case' } } },
            ...[ 'load', 'collection', 'out-of-test', 'run' ].map(function wrongPhase(phase) {
                return { ...error, cause: { phase } };
            })
        ];
        for (const observation of invalid) {
            scope.assert.equal(translate(result, [ observation ]).status, 'error');
        }
        return scope.assert.collect();
    }),
    test('matches canonical aliases in policy case and work attribution', function (scope) {
        const result = caseResult(null, 'runtime-policy');
        const error = policyError(result, 'permission');
        const id = { ...result.id, file: '/project/nested/../first.test.ts' };
        scope.assert.equal(
            translate(result, [ {
                ...error,
                attributedTo: id,
                attributedToWork: { ...result.workId, case: id }
            } ])
                .status,
            'killed'
        );
        return scope.assert.collect();
    }),
    test('rejects policy errors for eligible cases that did not execute', function (scope) {
        const { reply, baseline } = mutationCoverageFixture('off');
        const [ first, second ] = reply.result.perTest;
        if (first === undefined || second === undefined) {
            throw new Error('Missing mutation case fixtures.');
        }
        const selected = [ workIdentityKey(first.workId) ];
        const mutant = mutantExecutionResult(root, {
            ...reply,
            result: {
                ...reply.result,
                summary: { ...reply.result.summary, planned: 1 },
                perTest: [ first ],
                runnerErrors: [ policyError(second, 'permission') ]
            },
            data: {
                ...mutationLifecycleDataSchema.parse(reply.data),
                selected,
                completed: selected,
                coverage: { static: {}, perTest: {} }
            }
        }, { kind: 'mutant', baseline, selected, disableBail: true });
        scope.assert.equal(mutant.status, 'error');
        return scope.assert.collect();
    }),
    test('retains body and test-contract failures as kills', function (scope) {
        const outcomes: readonly Outcome[] = [
            { kind: 'fail', failures: [ bodyFailure ] },
            {
                kind: 'fail',
                failures: [ {
                    kind: 'test-contract',
                    code: 'no-assertions',
                    actual: 0,
                    expected: 'assertion',
                    summary: 'no assertions'
                } ]
            }
        ];
        for (const outcome of outcomes) {
            scope.assert.equal(translate(caseResult(outcome, 'fail'), []).status, 'killed');
        }
        return scope.assert.collect();
    }),
    test('rejects hidden cleanup failures and inconclusive outcomes despite policy evidence', function (scope) {
        for (
            const outcome of [ { kind: 'fail', failures: [ bodyFailure, cleanupFailure ] }, {
                kind: 'inconclusive',
                reason: 'inconclusive sentinel'
            } ] as const
        ) {
            const result = caseResult(null, 'runtime-policy');
            const retained = { ...result, attempts: [ { ...result.attempts[0], outcome } ] } as const;
            const mutant = translate(retained, [ policyError(result, 'permission') ]);
            scope.assert.equal(mutant.status, 'error');
            if (mutant.status === MutantRunStatus.Error) {
                scope.assert.true(mutant.errorMessage.includes('sentinel'));
            }
        }
        return scope.assert.collect();
    }),
    test('requires global hook evidence for a crashed verdict', function (scope) {
        const result = caseResult(null, 'crashed');
        scope.assert.equal(translate(result, []).status, 'error');
        scope.assert.equal(translate(result, [ policyError(result, 'permission') ]).status, 'error');
        return scope.assert.collect();
    }),
    ...([ 'crashed', 'runtime-policy' ] as const).map(function terminalVerdict(verdict) {
        return test(`keeps missing ${verdict} attribution ahead of retained timeouts`, function (scope) {
            const original = caseResult(null, verdict);
            const outcome = {
                kind: 'fail',
                failures: [ {
                    kind: 'timeout',
                    deadlineMilliseconds: 1,
                    elapsedMilliseconds: 2
                } ]
            } as const;
            const result = { ...original, attempts: [ { ...original.attempts[0], outcome } ] } as const;
            const subtype = verdict === 'crashed' ? 'uncaught-exception' : 'permission';
            scope.assert.equal(translate(result, []).status, 'error');
            scope.assert.equal(translate(result, [ policyError(result, subtype) ]).status, 'timeout');
            return scope.assert.collect();
        });
    }),
    test('rejects retry histories, conflicting identities, and contradictory verdicts', function (scope) {
        const result = caseResult({ kind: 'fail', failures: [ bodyFailure ] }, 'fail');
        const invalid: readonly PerTestResult[] = [
            { ...result, attempts: [ { ...result.attempts[0], attempt: { index: 1 } } ] },
            { ...result, attempts: [ result.attempts[0], result.attempts[0] ] },
            { ...result, retried: { attempts: 1, finalVerdict: 'fail' } },
            { ...result, id: { ...result.id, title: 'another case' } },
            { ...result, verdict: 'pass' },
            { ...result, attempts: [ { ...result.attempts[0], outcome: { kind: 'pass' } } ] }
        ];
        for (const observation of invalid) {
            scope.assert.equal(translate(observation, []).status, 'error');
        }
        return scope.assert.collect();
    }),
    test('never treats a skipped case as a policy kill', function (scope) {
        const result = caseResult({ kind: 'skip', reason: 'intentional' }, 'skip');
        scope.assert.equal(
            classifyMutationCase(root, result, [ policyError(result, 'permission') ], false).kind,
            'skip'
        );
        return scope.assert.collect();
    })
]);

const { runIfMain } = await import('../../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
