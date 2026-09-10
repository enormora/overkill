import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { FailedCompositeCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { BodyErrorTestFailure, FailOutcome, RunResult } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

async function executeSingleBody(body: TestBody): Promise<RunResult> {
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

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/error-assertion-execution.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() counts throws and awaited rejects as assertion boundaries',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    testScope.plan(2);
                    testScope.assert.throws(function throwExpectedError() {
                        throw new Error('expected');
                    }, { message: 'expected' });
                    await testScope.assert.rejects(async function rejectExpectedError() {
                        await Promise.reject(new Error('expected'));
                    }, { message: 'expected' });

                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() rejects unawaited async rejects assertions at collect',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
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
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() treats sync throws from rejects thunks as body errors',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                function throwBeforePromise(): never {
                    throw new TypeError('sync boom');
                }

                const result = await executeSingleBody(async function testBody(testScope: TestScope) {
                    await testScope.assert.rejects(throwBeforePromise, { message: 'sync boom' });

                    return testScope.assert.collect();
                });

                const outcome = firstFailOutcome(result);
                scope.require.notNull(outcome);
                const failure = firstBodyError(outcome);
                scope.require.notNull(failure);
                scope.assert.equal(failure.error.message, 'sync boom');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() reports throws matcher field failures under one composite boundary',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
