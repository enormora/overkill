import { runIfMain } from '#test-runner';
import { MutantRunStatus, type MutantRunResult } from '@stryker-mutator/api/test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import {
    workIdentityKey,
    type PerTestResult,
    type RunExecutionFailure,
    type RunExecutionReply
} from '../run/run.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { expiredMutantResult, mutantExecutionResult } from './mutation-results.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import type { MutationInvocationExpectation } from './mutation-observation.ts';
import { testNode as evidenceTestNode } from './mutation-evidence.test.ts';

const root = '/project';
const bodyFailure = {
    kind: 'body-error',
    error: { name: 'Error', message: 'earlier body sentinel', stack: null, thrown: null }
} as const;
const timeoutFailure = { kind: 'timeout', deadlineMilliseconds: 1, elapsedMilliseconds: 2 } as const;
const cleanupFailure = {
    kind: 'cleanup-error',
    error: { name: 'Error', message: 'cleanup sentinel', stack: null, thrown: null }
} as const;

type MutationResultFixture = {
    readonly reply: Extract<RunExecutionReply, { readonly kind: 'result'; }>;
    readonly expectation: Extract<MutationInvocationExpectation, { readonly kind: 'mutant'; }>;
};

function mutationInvocation(outcomes: readonly Exclude<PerTestResult['outcome'], null>[]): MutationResultFixture {
    const { reply, baseline } = mutationCoverageFixture('off');
    const perTest = reply.result.perTest.map(function caseOutcome(result, index): PerTestResult {
        const outcome = outcomes[index] ?? { kind: 'pass' };
        return {
            ...result,
            outcome,
            verdict: outcome.kind,
            attempts: [ { ...result.attempts[0], outcome, verdict: outcome.kind } ]
        };
    });
    return {
        reply: { ...reply, result: { ...reply.result, perTest } },
        expectation: {
            kind: 'mutant',
            baseline,
            selected: baseline.catalog.map(function identity(entry) {
                return entry.id;
            }),
            disableBail: true
        } as const
    };
}

function diagnostic(result: Readonly<MutantRunResult>): string {
    if (result.status === MutantRunStatus.Error) {
        return result.errorMessage;
    }
    if (result.status === MutantRunStatus.Timeout) {
        return result.reason ?? '';
    }
    throw new Error(`Expected an error or timeout, received ${result.status}.`);
}

type HitLimitFailures = {
    readonly direct: RunExecutionFailure;
    readonly valid: readonly RunExecutionFailure[];
    readonly invalid: readonly RunExecutionFailure[];
};

function hitLimitFailures(): HitLimitFailures {
    const guard = new Error('Stryker: Hit count limit reached (1)');
    const direct: RunExecutionFailure = {
        kind: 'error',
        name: 'Error',
        message: guard.message,
        cause: null,
        stack: null
    };
    const { runnerErrors } = runResultFactory.build({ runnerErrors: [ { subtype: 'loader', cause: guard } ] });
    const [ loaderError ] = runnerErrors;
    if (loaderError === undefined) {
        throw new Error('Missing loader error fixture.');
    }
    const loader: RunExecutionFailure = { ...direct, kind: 'collection-error', errors: [ loaderError ] };
    const invalid: readonly RunExecutionFailure[] = [
        { ...direct, cause: new Error('cleanup sentinel') },
        { ...direct, kind: 'config-error' },
        { ...direct, name: 'TypeError' },
        {
            ...direct,
            name: 'AggregateError',
            cause: { cause: guard, errors: [ guard, new Error('cleanup sentinel') ] }
        },
        { ...direct, message: 'Execution and lifecycle disposal failed.', cause: guard },
        { ...loader, errors: [ loaderError, { ...loaderError, cause: new Error('loader sentinel') } ] }
    ];
    return { direct, valid: [ direct, loader ], invalid };
}

export const testNode = suite('mutation result precedence', [
    evidenceTestNode,
    ...[ false, true ].map(function independentCancellation(cancelled) {
        return test(`native case timeout preserves independent cancellation ${String(cancelled)}`, function (scope) {
            const { reply, expectation } = mutationInvocation([]);
            const { runnerErrors } = runResultFactory.build({
                runnerErrors: [
                    { subtype: 'crash', message: 'case hard timeout', cause: { termination: 'hard-timeout' } },
                    ...cancelled
                        ? [ {
                            subtype: 'crash' as const,
                            message: 'independent cancellation sentinel',
                            cause: { termination: 'cancelled' }
                        } ]
                        : []
                ]
            });
            const result = mutantExecutionResult(root, {
                ...reply,
                result: { ...reply.result, runnerErrors },
                deadlineExceeded: false
            }, expectation);
            scope.assert.equal(result.status, cancelled ? 'error' : 'timeout');
            if (cancelled) {
                scope.assert.match(diagnostic(result), /independent cancellation sentinel/);
            }
            return scope.assert.collect();
        });
    }),
    ...[ false, true ].map(function cleanupError(withCleanupError) {
        return test(
            `retains an earlier kill alongside timeout and cleanup error ${String(withCleanupError)}`,
            function (scope) {
                const { reply, expectation } = mutationInvocation([
                    { kind: 'fail', failures: [ bodyFailure ] },
                    {
                        kind: 'fail',
                        failures: withCleanupError ? [ timeoutFailure, cleanupFailure ] : [ timeoutFailure ]
                    }
                ]);
                const result = mutantExecutionResult(root, reply, expectation);
                scope.assert.equal(result.status, withCleanupError ? 'error' : 'timeout');
                const message = diagnostic(result);
                scope.assert.match(message, /earlier body sentinel[\s\S]*timeout/u);
                for (const testCase of reply.result.perTest.slice(0, 2)) {
                    scope.assert.true(message.includes(workIdentityKey(testCase.workId)));
                }
                if (withCleanupError) {
                    scope.assert.true(message.includes('cleanup sentinel'));
                }
                return scope.assert.collect();
            }
        );
    }),
    test('retains a body failure when the same case times out during cleanup', function (scope) {
        const { reply, expectation } = mutationInvocation([ {
            kind: 'fail',
            failures: [ bodyFailure, timeoutFailure ]
        } ]);
        const result = mutantExecutionResult(root, reply, expectation);
        scope.assert.equal(result.status, 'timeout');
        scope.assert.true(diagnostic(result).includes('earlier body sentinel'));
        scope.assert.true(diagnostic(result).includes('deadlineMilliseconds: 1'));
        return scope.assert.collect();
    }),
    test('retains native failures when lifecycle observations are incomplete', function (scope) {
        const { reply, expectation } = mutationInvocation([ { kind: 'fail', failures: [ bodyFailure ] } ]);
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const result = mutantExecutionResult(root, { ...reply, data: { ...data, completed: [] } }, expectation);
        scope.assert.equal(result.status, 'error');
        scope.assert.true(
            diagnostic(result).startsWith('Execution did not deliver complete case lifecycle observations.')
        );
        scope.assert.true(diagnostic(result).includes('earlier body sentinel'));
        return scope.assert.collect();
    }),
    test('retains earlier failures when later case identities cannot be canonicalized', function (scope) {
        const { reply, expectation } = mutationInvocation([ { kind: 'fail', failures: [ bodyFailure ] } ]);
        const perTest = reply.result.perTest.map(function invalidLaterIdentity(result, index) {
            const workId = index === 1
                ? { ...result.workId, case: { ...result.id, file: '../outside.test.ts' } }
                : result.workId;
            return { ...result, id: workId.case, workId };
        });
        const result = mutantExecutionResult(root, { ...reply, result: { ...reply.result, perTest } }, expectation);
        scope.assert.equal(result.status, 'error');
        scope.assert.match(diagnostic(result), /earlier body sentinel/u);
        scope.assert.match(diagnostic(result), /Test identity escapes the mutation sandbox/u);
        scope.assert.true(diagnostic(result).includes(expectation.selected[0] ?? 'missing identity'));
        return scope.assert.collect();
    }),
    test('retains an infrastructure failure and a kill despite deadline and hit-limit expiry', function (scope) {
        const { reply, expectation } = mutationInvocation([ { kind: 'fail', failures: [ bodyFailure ] } ]);
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const { runnerErrors } = runResultFactory.build({
            runnerErrors: [ { subtype: 'reporter', message: 'delivery sentinel' } ]
        });
        const result = mutantExecutionResult(root, {
            ...reply,
            deadlineExceeded: true,
            data: { ...data, hitLimitExceeded: true },
            result: { ...reply.result, runnerErrors }
        }, expectation);
        scope.assert.equal(result.status, 'error');
        scope.assert.true(diagnostic(result).startsWith('delivery sentinel\n'));
        scope.assert.true(diagnostic(result).includes('earlier body sentinel'));
        return scope.assert.collect();
    }),
    ...[ false, true ].map(function hitLimit(exceeded) {
        return test(
            `retains killing diagnostics when the invocation expires with hit limit ${String(exceeded)}`,
            function (scope) {
                const { reply, expectation } = mutationInvocation([ { kind: 'fail', failures: [ bodyFailure ] } ]);
                const data = mutationLifecycleDataSchema.parse(reply.data);
                const result = mutantExecutionResult(root, {
                    ...reply,
                    deadlineExceeded: !exceeded,
                    data: { ...data, hitLimitExceeded: exceeded }
                }, expectation);
                scope.assert.equal(result.status, 'timeout');
                scope.assert.true(diagnostic(result).includes('earlier body sentinel'));
                return scope.assert.collect();
            }
        );
    }),
    test('requires a pure tracked hit-limit guard to classify a failure as timeout', function (scope) {
        const { reply, expectation } = mutationInvocation([]);
        const data = { ...mutationLifecycleDataSchema.parse(reply.data), hitLimitExceeded: true };
        const { direct, valid, invalid } = hitLimitFailures();
        for (const failure of valid) {
            scope.assert.deepEqual(
                mutantExecutionResult(root, { artifacts: [], kind: 'failure', data, failure }, expectation),
                {
                    status: MutantRunStatus.Timeout,
                    reason: 'Mutant exceeded its hit limit.'
                }
            );
        }
        for (const failure of invalid) {
            scope.assert.equal(
                mutantExecutionResult(root, { artifacts: [], kind: 'failure', data, failure }, expectation).status,
                'error'
            );
        }
        scope.assert.equal(
            mutantExecutionResult(root, { artifacts: [], kind: 'failure', data: null, failure: direct }, expectation)
                .status,
            'error'
        );
        return scope.assert.collect();
    }),
    test('preserves terminal diagnostics when the outer invocation deadline expires', function (scope) {
        const error: MutantRunResult = { status: MutantRunStatus.Error, errorMessage: 'infrastructure sentinel' };
        const timeout: MutantRunResult = { status: MutantRunStatus.Timeout, reason: 'timeout sentinel' };
        scope.assert.deepEqual(expiredMutantResult(error), error);
        scope.assert.deepEqual(expiredMutantResult(timeout), timeout);
        const killed = expiredMutantResult({
            status: MutantRunStatus.Killed,
            killedBy: [ 'case' ],
            nrOfTests: 1,
            failureMessage: 'earlier body sentinel'
        });
        scope.assert.equal(killed.status, 'timeout');
        scope.assert.true(diagnostic(killed).includes('earlier body sentinel'));
        for (const completed of [ null, { status: MutantRunStatus.Survived, nrOfTests: 1 } ] as const) {
            scope.assert.deepEqual(expiredMutantResult(completed), {
                status: MutantRunStatus.Timeout,
                reason: 'Mutant invocation exceeded its deadline.'
            });
        }
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
