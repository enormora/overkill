import { type TestScope, suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

import { defineCompositeAssertion } from '../assert/assertion-extension.ts';
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

const compositeThrows = defineCompositeAssertion({
    name: 'compositeThrows',
    assert(check, control: unknown) {
        return check.throws(function () {
            throw control;
        }, { exact: control });
    }
});

const compositeRejects = defineCompositeAssertion({
    name: 'compositeRejects',
    async assert(check, control: unknown) {
        return await check.rejects(() => Promise.reject(control), { exact: control });
    }
});

const foreignThrows = defineCompositeAssertion({
    name: 'foreignThrows',
    assert(check, control: unknown) {
        return check.fromThrowable('foreign', function () {
            throw control;
        });
    }
});

const foreignRejects = defineCompositeAssertion({
    name: 'foreignRejects',
    async assert(check, control: unknown) {
        return await check.fromRejectable('foreign', () => Promise.reject(control));
    }
});

const invalidComposite = defineCompositeAssertion({
    name: 'invalidComposite',
    assert(check) {
        const child = check.true(true);
        Reflect.deleteProperty(child, 'check');
        return child;
    }
});

const invalidAsyncComposite = defineCompositeAssertion({
    name: 'invalidAsyncComposite',
    async assert(check) {
        const child = check.true(true);
        Reflect.deleteProperty(child, 'check');
        return await Promise.resolve(child);
    }
});

type CasePlan = Parameters<EngineCaseBody>[0]['plan'];

function invalidPlanSignal(plan: CasePlan, count: number): unknown {
    try {
        plan(count);
    } catch (error: unknown) {
        return error;
    }
    throw new Error('Expected invalid plan to throw.');
}

function callWithInvalidReference(target: unknown): void {
    if (typeof target !== 'function') {
        throw new TypeError('Expected a callable assertion facade.');
    }
    Reflect.apply(target, null, [ 'invalid reference' ]);
}

export const testNode = suite('Error assertion execution', [
    test('keeps distinct caught contract failures and a later body error', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            invalidPlanSignal(testScope.plan, 0);
            invalidPlanSignal(testScope.plan, 0);
            throw new Error('Application failure.');
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures.map(failure =>
            failure.kind === 'test-contract' ? failure.code : failure.kind
        ), [ 'invalid-plan', 'invalid-plan', 'body-error' ]);

        return scope.assert.collect();
    }),
    test('retains caught collect, reference, and composite contract failures', async function (scope: TestScope) {
        const result = await executeSingleBody(async function testBody(testScope) {
            const operations = [
                () => testScope.assert.collect(),
                () => callWithInvalidReference(testScope.assert),
                () => testScope.assert(invalidComposite),
                () => testScope.assert(invalidAsyncComposite)
            ];
            for (const operation of operations) {
                try {
                    await operation();
                } catch (error: unknown) {
                    testScope.assert.instanceOf(error, Error);
                }
            }
            testScope.assert.true(true);
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures.map(failure =>
            failure.kind === 'test-contract' ? failure.code : failure.kind
        ), [ 'no-assertions', 'invalid-assertion-reference', 'invalid-composite-result', 'invalid-composite-result' ]);

        return scope.assert.collect();
    }),
    test('reports one contract failure when its signal escapes', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.plan(0);
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures.map(failure =>
            failure.kind === 'test-contract' ? failure.code : failure.kind
        ), [ 'invalid-plan' ]);

        return scope.assert.collect();
    }),
    test('propagates controls through assertion adapters and settles pending slots', async function (scope: TestScope) {
        const result = await executeSingleBody(async function testBody(testScope) {
            const control = invalidPlanSignal(testScope.plan, 0);
            const operations = [
                () => testScope.assert.throws(function () {
                    throw control;
                }, { exact: control }),
                () => testScope.assert.rejects(() => Promise.reject(control), { exact: control }),
                () => testScope.assert(compositeThrows, control),
                () => testScope.assert(compositeRejects, control),
                () => testScope.assert(foreignThrows, control),
                () => testScope.assert(foreignRejects, control)
            ];
            for (const operation of operations) {
                let caught: unknown = null;
                try {
                    await operation();
                } catch (error: unknown) {
                    caught = error;
                }
                testScope.assert.equal(caught, control);
            }
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures.map(failure =>
            failure.kind === 'test-contract' ? failure.code : failure.kind
        ), [ 'invalid-plan' ]);

        return scope.assert.collect();
    }),
    test('reports a permission denial from rejects as a runner error', async function (scope) {
        const denied = Object.assign(new Error('Permission denied.'), { code: 'ERR_ACCESS_DENIED' });
        const result = await executeSingleBody(async function testBody(testScope) {
            await testScope.assert.rejects(() => Promise.reject(denied), { exact: denied });
            return testScope.assert.collect();
        });
        scope.assert.equal(result.summary.passed, 0);
        scope.assert.equal(result.runnerErrors.length, 1);
        scope.assert.equal(result.runnerErrors[0]?.subtype, 'permission');
        return scope.assert.collect();
    }),
    test('counts throws and awaited rejects as assertion boundaries', async function (scope) {
        class RateLimitError extends Error {
            public constructor() {
                super('Rate limit exceeded.');
                this.name = 'TestContractSignalError';
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
