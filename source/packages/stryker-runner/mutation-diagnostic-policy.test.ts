import { type TestScope, suite as authoredSuite, test as authoredTest } from '@overkill-dev/test';

import { DryRunStatus, MutantRunStatus, TestStatus, type MutantRunResult } from '@stryker-mutator/api/test-runner';

import { memoryMutationDiagnostics } from '../../test-support/memory-mutation-diagnostics.ts';
import { testNode as storage } from './mutation-diagnostic-storage-policy.test.ts';
import { testNode as evidence } from './mutation-diagnostic-evidence-policy.test.ts';
import { recordMutationInvocation } from './mutation-diagnostic-persistence.ts';

const dry = { kind: 'dry' } as const;
const survived = { status: MutantRunStatus.Survived, nrOfTests: 1 } as const;
const killed: MutantRunResult = {
    status: MutantRunStatus.Killed,
    killedBy: [ 'case' ],
    failureMessage: 'Killed.',
    nrOfTests: 1
};
export const testNode = authoredSuite('mutation diagnostic retention policy', [
    storage,
    evidence,
    ...[ false, true ].map(function (withReason) {
        return authoredTest(
            `retains timeout diagnostics with an explicit reason ${withReason}`,
            async function (scope: TestScope) {
                const fixture = memoryMutationDiagnostics(scope, 'failures', null);
                const result = withReason
                    ? { status: DryRunStatus.Timeout, reason: 'deadline detail' } as const
                    : { status: DryRunStatus.Timeout } as const;
                await recordMutationInvocation({
                    ...fixture,
                    execution: dry,
                    async run() {
                        return result;
                    }
                }, fixture.runtime);
                scope.assert.includes(
                    JSON.stringify(fixture.documents[0]?.failure),
                    withReason ? 'deadline detail' : 'Mutation invocation timed out.'
                );
                return scope.assert.collect();
            }
        );
    }),
    authoredTest(
        'retains an execution failure reply even when the adapter returns survival',
        async function (scope: TestScope) {
            const fixture = memoryMutationDiagnostics(scope, 'all', null);
            const failure = {
                kind: 'error',
                name: 'Error',
                message: 'reply failed',
                stack: null,
                cause: null
            } as const;
            await recordMutationInvocation({
                ...fixture,
                execution: dry,
                async run(diagnostics) {
                    diagnostics.record({ kind: 'failure', failure, artifacts: [], data: null });
                    return survived;
                }
            }, fixture.runtime);
            scope.assert.includes(JSON.stringify(fixture.documents[0]?.failure), 'reply failed');
            return scope.assert.collect();
        }
    ),
    authoredTest(
        'reports persistence failures while retaining the prior adapter diagnostic',
        async function (scope: TestScope) {
            const fixture = memoryMutationDiagnostics(scope, 'all', new Error('Storage failed.'));
            await scope.assert.rejects(async function () {
                await recordMutationInvocation({
                    ...fixture,
                    execution: dry,
                    async run(diagnostics) {
                        diagnostics.record(fixture.reply);
                        return survived;
                    }
                }, fixture.runtime);
            }, { message: /Mutation diagnostic persistence failed: Error: Storage failed\./u });
            scope.assert.deepEqual(fixture.documents, []);
            return scope.assert.collect();
        }
    ),

    ...([ 'off', 'failures', 'all' ] as const).map(function (mode) {
        return authoredTest(
            `${mode} retains successful evidence according to policy`,
            async function (scope: TestScope) {
                const fixture = memoryMutationDiagnostics(scope, mode, null);
                const result = await recordMutationInvocation({
                    ...fixture,
                    execution: dry,
                    async run(diagnostics) {
                        diagnostics.record(fixture.reply);
                        return survived;
                    }
                }, fixture.runtime);
                scope.assert.equal(result, survived);
                scope.assert.equal(fixture.documents.length, mode === 'all' ? 1 : 0);
                return scope.assert.collect();
            }
        );
    }),
    ...([ 'off', 'failures', 'all' ] as const).map(function (mode) {
        return authoredTest(
            `${mode} retains killed mutant evidence according to policy`,
            async function (scope: TestScope) {
                const fixture = memoryMutationDiagnostics(scope, mode, null);
                await recordMutationInvocation({
                    ...fixture,
                    execution: { kind: 'mutant', mutant: 'mutant' },
                    async run(diagnostics) {
                        diagnostics.record(fixture.reply);
                        return killed;
                    }
                }, fixture.runtime);
                scope.assert.equal(fixture.documents.length, mode === 'off' ? 0 : 1);
                return scope.assert.collect();
            }
        );
    }),
    authoredTest('records the exact invocation identity and checkpoint evidence', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'all', null);
        await recordMutationInvocation({
            ...fixture,
            execution: dry,
            async run(diagnostics) {
                diagnostics.record(fixture.reply);
                return survived;
            }
        }, fixture.runtime);
        const document = fixture.documents[0];
        scope.require.defined(document);
        scope.assert.deepEqual({
            campaign: document.campaign,
            invocation: document.invocation,
            execution: document.execution,
            seed: document.seed,
            profile: document.profile,
            failure: document.failure
        }, {
            campaign: 'campaign',
            invocation: 'invocation',
            execution: dry,
            seed: '42',
            profile: 'unit',
            failure: null
        });
        scope.assert.deepEqual(document.diagnostics.perTest, []);
        scope.assert.equal(document.diagnostics.artifacts.length, 1);
        return scope.assert.collect();
    }),
    authoredTest(
        'deduplicates explicit completion and final completion for the same result',
        async function (scope: TestScope) {
            const fixture = memoryMutationDiagnostics(scope, 'all', null);
            await recordMutationInvocation({
                ...fixture,
                execution: dry,
                async run(diagnostics) {
                    diagnostics.record(fixture.reply);
                    await diagnostics.complete(survived);
                    await diagnostics.complete(survived);
                    return survived;
                }
            }, fixture.runtime);
            scope.assert.equal(fixture.documents.length, 1);
            return scope.assert.collect();
        }
    ),
    authoredTest('retains failed tests within a complete dry run', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'failures', null);
        await recordMutationInvocation({
            ...fixture,
            execution: dry,
            async run(diagnostics) {
                diagnostics.record(fixture.reply);
                return {
                    status: DryRunStatus.Complete,
                    tests: [ {
                        id: 'case',
                        name: 'case',
                        status: TestStatus.Failed,
                        timeSpentMs: 1,
                        failureMessage: 'Failed.'
                    } ]
                };
            }
        }, fixture.runtime);
        scope.assert.equal(fixture.documents.length, 1);
        return scope.assert.collect();
    }),
    authoredTest('retains error results even before an execution reply arrives', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'failures', null);
        await recordMutationInvocation({
            ...fixture,
            execution: dry,
            async run() {
                return { status: DryRunStatus.Error, errorMessage: 'Initialization failed.' };
            }
        }, fixture.runtime);
        scope.assert.equal(fixture.documents.length, 1);
        scope.assert.includes(JSON.stringify(fixture.documents[0]?.failure), 'Initialization failed.');
        return scope.assert.collect();
    }),
    authoredTest('retains timeout reasons without an execution reply', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'failures', null);
        await recordMutationInvocation({
            ...fixture,
            execution: dry,
            async run() {
                return { status: DryRunStatus.Timeout, reason: 'Deadline expired.' };
            }
        }, fixture.runtime);
        scope.assert.equal(fixture.documents.length, 1);
        scope.assert.includes(JSON.stringify(fixture.documents[0]?.failure), 'Deadline expired.');
        return scope.assert.collect();
    }),
    authoredTest('retains deadline evidence after an otherwise successful result', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'failures', null);
        await recordMutationInvocation({
            ...fixture,
            execution: dry,
            async run(diagnostics) {
                diagnostics.record(fixture.reply);
                fixture.clock.advanceByMilliseconds(50);
                return survived;
            }
        }, fixture.runtime);
        scope.assert.equal(fixture.documents.length, 1);
        scope.assert.includes(JSON.stringify(fixture.documents[0]?.failure), 'InvocationDeadlineExceededError');
        return scope.assert.collect();
    }),
    authoredTest('does not write empty successful evidence', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'all', null);
        await recordMutationInvocation({
            ...fixture,
            execution: dry,
            async run() {
                return survived;
            }
        }, fixture.runtime);
        scope.assert.deepEqual(fixture.documents, []);
        return scope.assert.collect();
    }),
    authoredTest('preserves execution errors after retaining failure evidence', async function (scope: TestScope) {
        const fixture = memoryMutationDiagnostics(scope, 'failures', null);
        const error = new Error('Execution failed.');
        let failure: unknown = null;
        try {
            await recordMutationInvocation({
                ...fixture,
                execution: dry,
                async run() {
                    throw error;
                }
            }, fixture.runtime);
        } catch (error_: unknown) {
            failure = error_;
        }
        scope.assert.equal(failure, error);
        scope.assert.equal(fixture.documents.length, 1);
        return scope.assert.collect();
    }),
    authoredTest('reports execution and persistence failures together', async function (scope: TestScope) {
        const failures = { storage: new Error('Storage failed.'), execution: new Error('Execution failed.') };
        const fixture = memoryMutationDiagnostics(scope, 'failures', failures.storage);
        let failure: unknown = null;
        try {
            await recordMutationInvocation({
                ...fixture,
                execution: dry,
                async run() {
                    throw failures.execution;
                }
            }, fixture.runtime);
        } catch (error: unknown) {
            failure = error;
        }
        scope.require.instanceOf(failure, AggregateError);
        scope.assert.equal(failure.errors[0], failures.execution);
        scope.assert.includes(String(failure.errors[1]), 'Storage failed.');
        return scope.assert.collect();
    })
]);
