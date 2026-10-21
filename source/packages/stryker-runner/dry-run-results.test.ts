import { DryRunStatus, TestStatus } from '@stryker-mutator/api/test-runner';
import { suite, test } from '../test/test.entry-point.ts';
import { workIdentityKey, type PerTestResult, type RunExecutionReply } from '../run/run.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { runResultFactory } from '../../test-support/run-result-factory.ts';
import { testNode as executionTestNode } from '../../integration-tests/run/runner-stryker-dry-run.test.ts';
import { dryMutationResult } from './dry-run-results.ts';
import { mutationLifecycleDataSchema } from './mutation-catalog.ts';
import { testNode as mutantResultsTestNode } from './mutation-results.test.ts';
import { testNode as precedenceTestNode } from './mutation-precedence.test.ts';

type ResultReply = Extract<RunExecutionReply, { readonly kind: 'result'; }>;
const expectation = { kind: 'dry', baseline: null, testFiles: null } as const;
const timeoutFailure = { kind: 'timeout', deadlineMilliseconds: 1, elapsedMilliseconds: 2 } as const;
const cleanupFailure = {
    kind: 'cleanup-error',
    error: { name: 'Error', message: 'cleanup sentinel', stack: null, thrown: null }
} as const;
const bodyFailure = {
    kind: 'body-error',
    error: { name: 'Error', message: 'body sentinel', stack: null, thrown: null }
} as const;

function withOutcome(reply: ResultReply, outcome: PerTestResult['outcome']): ResultReply {
    return {
        ...reply,
        result: {
            ...reply.result,
            perTest: reply.result.perTest.map(function firstCase(result, index) {
                return index === 0
                    ? {
                        ...result,
                        verdict: outcome?.kind ?? 'crashed',
                        outcome,
                        attempts: [ { ...result.attempts[0], verdict: outcome?.kind ?? 'crashed', outcome } ]
                    }
                    : result;
            })
        }
    };
}

export const testNode = suite('structured dry-run results', [
    precedenceTestNode,
    mutantResultsTestNode,
    executionTestNode,
    test('reports mixed outcomes with structural identities and fractional millisecond durations', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        const results = runResultFactory
            .build({
                perTest: [
                    {
                        id: { file: 'first.test.ts', suite: [], title: 'first', params: null },
                        durationMicroseconds: 1537,
                        outcome: { kind: 'pass' }
                    },
                    {
                        id: { file: 'second.test.ts', suite: [], title: 'second', params: null },
                        durationMicroseconds: 2750,
                        outcome: { kind: 'fail' }
                    },
                    {
                        id: { file: 'unrelated.test.ts', suite: [], title: 'unrelated', params: null },
                        durationMicroseconds: 0,
                        outcome: { kind: 'skip', reason: 'intentional' }
                    }
                ]
            })
            .perTest;
        const result = dryMutationResult(
            '/project',
            {
                ...reply,
                result: { ...reply.result, perTest: results },
                data: {
                    ...data,
                    catalog: data.catalog.map(function intentionalSkip(entry, index) {
                        return index === 2 ? { ...entry, skipReason: 'intentional' } : entry;
                    })
                }
            },
            'perTest',
            expectation
        );
        if (result.status !== DryRunStatus.Complete) {
            throw new Error('Expected a complete mixed dry run.');
        }
        scope.assert.deepEqual(
            result.tests.map(function reportedCase(entry) {
                return { id: entry.id, status: entry.status, duration: entry.timeSpentMs, file: entry.fileName };
            }),
            [
                {
                    id: '["first.test.ts",[],"first",null]',
                    status: TestStatus.Success,
                    duration: 1.537,
                    file: 'first.test.ts'
                },
                {
                    id: '["second.test.ts",[],"second",null]',
                    status: TestStatus.Failed,
                    duration: 2.75,
                    file: 'second.test.ts'
                },
                {
                    id: '["unrelated.test.ts",[],"unrelated",null]',
                    status: TestStatus.Skipped,
                    duration: 0,
                    file: 'unrelated.test.ts'
                }
            ]
        );
        return scope.assert.collect();
    }),
    ...([ { kind: 'fail', failures: [ bodyFailure ] }, {
        kind: 'fail',
        failures: [ {
            kind: 'test-contract',
            code: 'no-assertions',
            actual: 0,
            expected: 'assertion',
            summary: 'no assertions'
        } ]
    } ] as const)
        .map(function ordinaryFailure(outcome) {
            return test(`reports ${outcome.failures[0].kind} as an individual failure`, function (scope) {
                const { reply } = mutationCoverageFixture('off');
                const result = dryMutationResult('/project', withOutcome(reply, outcome), 'off', expectation);
                if (result.status !== DryRunStatus.Complete) {
                    throw new Error('Expected an individual failed test.');
                }
                scope.assert.equal(result.tests[0]?.status, TestStatus.Failed);
                return scope.assert.collect();
            });
        }),
    ...([ [ cleanupFailure ], [ bodyFailure, cleanupFailure ], [
        timeoutFailure,
        cleanupFailure
    ] ] as const)
        .map(function cleanupFailures(failures) {
            return test(
                `rejects ${
                    failures
                        .map(function (failure) {
                            return failure.kind;
                        })
                        .join(' and ')
                }`,
                function (scope) {
                    const { reply } = mutationCoverageFixture('perTest');
                    const result = dryMutationResult(
                        '/project',
                        {
                            ...withOutcome(reply, { kind: 'fail', failures }),
                            deadlineExceeded: true,
                            result: {
                                ...withOutcome(reply, { kind: 'fail', failures }).result,
                                runnerErrors: runResultFactory
                                    .build({
                                        runnerErrors: [ { message: 'delivery sentinel' } ]
                                    })
                                    .runnerErrors
                            }
                        },
                        'perTest',
                        expectation
                    );
                    if (result.status !== DryRunStatus.Error) {
                        throw new Error('Expected cleanup infrastructure error.');
                    }
                    scope.assert.match(result.errorMessage, /delivery sentinel[\s\S]*cleanup sentinel/u);
                    scope.assert.match(result.errorMessage, /\["first.test.ts",\[\],"first",null\]/u);
                    for (const failure of failures) {
                        scope.assert.match(result.errorMessage, new RegExp(failure.kind, 'u'));
                    }
                    scope.assert.deepEqual(result, { status: DryRunStatus.Error, errorMessage: result.errorMessage });
                    return scope.assert.collect();
                }
            );
        }),
    test('preserves every assertion failure when cleanup invalidates the case', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const failed = runResultFactory.build({ perTest: [ { outcome: { kind: 'fail' } } ] }).perTest[0];
        if (failed?.outcome?.kind !== 'fail') {
            throw new Error('Missing assertion outcome.');
        }
        const result = dryMutationResult(
            '/project',
            withOutcome(reply, {
                kind: 'fail',
                failures: [
                    failed.outcome.failures[0],
                    ...Array.from({ length: 110 }, function () {
                        return bodyFailure;
                    }),
                    cleanupFailure
                ]
            }),
            'perTest',
            expectation
        );
        if (result.status !== DryRunStatus.Error) {
            throw new Error('Expected cleanup infrastructure error.');
        }
        scope.assert.match(result.errorMessage, /assertion[\s\S]*cleanup sentinel/u);
        scope.assert.equal(result.errorMessage.match(/body sentinel/gu)?.length, 110);
        return scope.assert.collect();
    }),
    test('rejects unsupported case failures as infrastructure errors', function (scope) {
        const { reply } = mutationCoverageFixture('off');
        const result = dryMutationResult(
            '/project',
            withOutcome(reply, {
                kind: 'fail',
                failures: [ {
                    kind: 'hedged-duplicate-conflict',
                    summary: 'unsupported sentinel',
                    artifact: {
                        attempt: null,
                        runtimes: [],
                        workload: null,
                        sequence: 0,
                        scope: { kind: 'run' },
                        subtype: 'hedged-conflict'
                    }
                } ]
            }),
            'off',
            expectation
        );
        if (result.status !== DryRunStatus.Error) {
            throw new Error('Expected an unsupported failure error.');
        }
        scope.assert.match(result.errorMessage, /unsupported sentinel/u);
        return scope.assert.collect();
    }),
    test('returns errors for inconclusive and missing outcomes', function (scope) {
        const { reply } = mutationCoverageFixture('off');
        for (const outcome of [ null, { kind: 'inconclusive', reason: 'uncertain sentinel' } ] as const) {
            const result = dryMutationResult('/project', withOutcome(reply, outcome), 'off', expectation);
            scope.assert.equal(result.status, DryRunStatus.Error);
        }
        return scope.assert.collect();
    }),
    test('rejects unsupported verdicts even when a failed outcome is available', function (scope) {
        const { reply } = mutationCoverageFixture('off');
        for (const verdict of [ 'crashed', 'inconclusive', 'process-exhausted', 'runtime-policy' ] as const) {
            const result = dryMutationResult(
                '/project',
                {
                    ...reply,
                    result: {
                        ...reply.result,
                        perTest: withOutcome(reply, { kind: 'fail', failures: [ bodyFailure ] })
                            .result
                            .perTest
                            .map(function unsupportedVerdict(entry, index) {
                                return index === 0 ? { ...entry, verdict } : entry;
                            })
                    }
                },
                'off',
                expectation
            );
            scope.assert.equal(result.status, DryRunStatus.Error);
        }
        return scope.assert.collect();
    }),
    test('returns timeout replies without completed tests or coverage', function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        for (
            const timedReply of [
                { ...reply, deadlineExceeded: true },
                withOutcome(reply, { kind: 'fail', failures: [ timeoutFailure ] }),
                { artifacts: [], kind: 'timeout', data: null }
            ] as const
        ) {
            const result = dryMutationResult('/project', timedReply, 'perTest', expectation);
            scope.assert.deepEqual(result, {
                status: DryRunStatus.Timeout,
                reason: timedReply.kind === 'timeout'
                    ? 'Dry run exceeded its deadline.'
                    : 'Dry run exceeded its deadline or test timeout.'
            });
        }
        return scope.assert.collect();
    }),
    test('retains checkpoint infrastructure errors when a later case exceeds its deadline', function (scope) {
        const { reply } = mutationCoverageFixture('off');
        const data = mutationLifecycleDataSchema.parse(reply.data);
        scope.assert.deepEqual(
            dryMutationResult(
                '/project',
                { artifacts: [], kind: 'timeout', data: { ...data, infrastructureErrors: [ 'cleanup sentinel' ] } },
                'off',
                expectation
            ),
            { status: DryRunStatus.Error, errorMessage: 'cleanup sentinel' }
        );
        scope.assert.deepEqual(
            dryMutationResult(
                '/project',
                {
                    artifacts: [],
                    kind: 'timeout',
                    data: { ...data, caseFailures: [ { id: 'case', kind: 'error', message: 'case sentinel' } ] }
                },
                'off',
                expectation
            ),
            { status: DryRunStatus.Error, errorMessage: 'case sentinel' }
        );
        return scope.assert.collect();
    }),
    test('rejects malformed timeout checkpoints', function (scope) {
        const result = dryMutationResult('/project', { artifacts: [], kind: 'timeout', data: {} }, 'off', expectation);
        scope.assert.equal(result.status, DryRunStatus.Error);
        return scope.assert.collect();
    }),
    test('returns execution failure diagnostics without completing a dry run', function (scope) {
        const result = dryMutationResult(
            '/project',
            {
                artifacts: [],
                kind: 'failure',
                data: null,
                failure: { kind: 'error', name: 'Error', message: 'execution sentinel', cause: null, stack: null }
            },
            'off',
            expectation
        );
        scope.assert.deepEqual(result, { status: DryRunStatus.Error, errorMessage: 'execution sentinel' });
        return scope.assert.collect();
    }),
    test('retains an infrastructure error when runner diagnostics are empty', function (scope) {
        const { reply } = mutationCoverageFixture('off');
        const { runnerErrors } = runResultFactory.build({ runnerErrors: [ { message: '' } ] });
        scope.assert.deepEqual(
            dryMutationResult(
                '/project',
                {
                    ...reply,
                    result: { ...reply.result, runnerErrors }
                },
                'off',
                expectation
            ),
            { status: DryRunStatus.Error, errorMessage: 'Dry run failed.' }
        );
        return scope.assert.collect();
    }),
    test('omits unknown filenames without replacing structural identity with the display name', function (scope) {
        const native = runResultFactory.build({ perTest: [ { durationMicroseconds: 1234 } ] });
        const ids = native.perTest.map(function (result) {
            return workIdentityKey(result.workId);
        });
        const result = dryMutationResult(
            '/project',
            {
                kind: 'result',
                deadlineExceeded: false,
                result: { ...native, summary: { ...native.summary, planned: 1 } },
                data: {
                    catalog: native.perTest.map(function catalogEntry(entry) {
                        return {
                            id: workIdentityKey(entry.workId),
                            work: entry.workId,
                            annotations: { ownership: [], tags: [] },
                            controls: { capture: null, duplicateExecution: null, timeoutMilliseconds: null },
                            skipReason: null
                        };
                    }),
                    selected: ids,
                    completed: ids,
                    coverage: { static: {}, perTest: {} },
                    bailed: false,
                    caseFailures: [],
                    infrastructureErrors: [],
                    hitLimitExceeded: false
                }
            },
            'off',
            expectation
        );
        if (result.status !== DryRunStatus.Complete) {
            throw new Error('Expected a complete case without a file origin.');
        }
        scope.assert.deepEqual(result.tests, [ {
            id: '[null,["root"],"passes",null]',
            name: 'root > passes',
            timeSpentMs: 1.234,
            status: TestStatus.Success
        } ]);
        return scope.assert.collect();
    })
]);
