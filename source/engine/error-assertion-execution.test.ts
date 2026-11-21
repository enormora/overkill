import { type TestNode, type TestScope, suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

import type { FailedCompositeCheck } from '../assertion-protocol/assertion-node-shape.ts';

import type { BodyErrorTestFailure, FailOutcome, RunResult } from './run-result.ts';

async function executeSingleBody(body: EngineCaseBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body,
                        annotations: {},
                        controls: {},
                        title: 'case'
                    })
                ],
                annotations: {},
                controls: {},
                title: 'root'
            })
        )
    );
}

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome?.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

function firstCompositeCheck(outcome: FailOutcome): FailedCompositeCheck | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        const check = failure.checks[0];

        if (check.kind === 'composite') {
            return check;
        }
    }

    return null;
}

function firstBodyError(outcome: FailOutcome): BodyErrorTestFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'body-error') {
        return failure;
    }

    return null;
}

export const testNode: TestNode = suite('Error assertion execution', [
    test('counts throws and awaited rejects as assertion boundaries', async function (scope) {
        class RateLimitError extends Error {
            public constructor() {
                super('Rate limit exceeded.');
                this.name = 'RateLimitError';
            }
        }

        const result = await executeSingleBody(async function testBody(testScope) {
            testScope.plan(2);
            testScope.assert.throws(function throwExpectedError() {
                throw new RateLimitError();
            }, { type: RateLimitError });
            await testScope.assert.rejects(async function rejectExpectedError() {
                await Promise.reject(new Error('expected'));
            }, { type: Error, message: 'expected' });

            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.passed, 1);

        return scope.assert.collect();
    }),
    test('rejects unawaited async rejects assertions at collect', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            const pendingAssertions = [
                testScope.assert.rejects(async function rejectExpectedError() {
                    await Promise.reject(new Error('expected'));
                }, { message: 'expected' })
            ];

            scope.assert.equal(pendingAssertions.length, 1);
            return testScope.assert.collect();
        });

        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures, [
            {
                actual: 'pending async assertion',
                code: 'pending-async-assertion',
                expected: 'all async assertions awaited before collect',
                kind: 'test-contract',
                summary: 'Async assertion must be awaited before scope.assert.collect().'
            }
        ]);

        return scope.assert.collect();
    }),
    test('treats sync throws from rejects thunks as body errors', async function (scope: TestScope) {
        function throwBeforePromise(): never {
            throw new TypeError('sync boom');
        }

        const result = await executeSingleBody(async function testBody(testScope) {
            await testScope.assert.rejects(throwBeforePromise, { message: 'sync boom' });

            return testScope.assert.collect();
        });

        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        const failure = firstBodyError(outcome);
        scope.require.notNull(failure);
        scope.assert.equal(failure.error.message, 'sync boom');

        return scope.assert.collect();
    }),
    test(
        'reports throws matcher field failures under one composite boundary',
        async function (scope: TestScope) {
            const result = await executeSingleBody(function testBody(testScope) {
                testScope.assert.throws(
                    function throwWrongError() {
                        throw new TypeError('actual');
                    },
                    { message: 'expected', type: RangeError },
                    { message: 'throw contract' }
                );

                return testScope.assert.collect();
            });
            const outcome = firstFailOutcome(result);
            scope.require.notNull(outcome);
            const composite = firstCompositeCheck(outcome);
            scope.require.notNull(composite);

            scope.assert.equal(composite.summary, 'throw contract');
            scope.assert.deepEqual(
                composite.children.map(function summaryOf(child) {
                    return child.summary;
                }),
                [
                    'Expected thrown value to be an instance of the constructor.',
                    'Expected thrown value message to equal the string.'
                ]
            );

            return scope.assert.collect();
        }
    )
]);
