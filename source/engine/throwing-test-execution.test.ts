import { AssertionError } from 'node:assert';
import assert from 'node:assert/strict';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { AssertionTestFailure, FailOutcome, RunResult } from './run-result.ts';
import type { ThrowingTestBody, ThrowingTestScope } from './test-node.ts';
import { isNodeAssertionError } from './node-assertion-error.ts';

async function executeSingleThrowingBody(body: ThrowingTestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createThrowingTestCase({
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

function firstAssertionFailure(outcome: FailOutcome): AssertionTestFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        return failure;
    }

    return null;
}

function assertSourceLocationInThisFile(scope: OverkillScope, location: unknown): void {
    if (typeof location !== 'object' || location === null || !Object.hasOwn(location, 'kind')) {
        scope.assert.fail({ message: 'Expected source location.' });

        return;
    }

    if (Reflect.get(location, 'kind') !== 'known') {
        scope.assert.equal(Reflect.get(location, 'kind'), 'known');

        return;
    }

    const file: unknown = Reflect.get(location, 'file');

    scope.require.string(file);
    scope.assert.match(
        file.replaceAll('\\', '/'),
        /source\/engine\/throwing-test-execution\.test\.[cm]?[jt]s$/u
    );
}

function assertNodeAssertionFailure(scope: OverkillScope, failure: AssertionTestFailure): void {
    const check = failure.checks[0];
    const child = check.kind === 'composite' ? check.children[0] : null;

    if (child === null) {
        scope.assert.equal(check.kind, 'composite');

        return;
    }

    if (child.kind !== 'foreign') {
        scope.assert.equal(child.kind, 'foreign');

        return;
    }

    scope.assert.deepEqual([ child.label, child.source ], [ 'node:assert', 'assert' ]);
    assertSourceLocationInThisFile(scope, child.sourceLocations[0]);
}

function assertUnknownNodeAssertionLocation(scope: OverkillScope, failure: AssertionTestFailure): void {
    const check = failure.checks[0];
    if (check.kind !== 'composite') {
        scope.assert.equal(check.kind, 'composite');

        return;
    }

    const child = check.children[0];
    if (child.kind !== 'foreign') {
        scope.assert.equal(child.kind, 'foreign');

        return;
    }

    scope.assert.deepEqual(child.sourceLocations, [ { kind: 'unknown' } ]);
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/engine/throwing-test-execution.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() lets throwing test cases pass with no recorded assertions',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(function noAssertions() {
                    return undefined;
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() evaluates assertions recorded by throwing test cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(function failedAssertion(testScope) {
                    testScope.assert.equal(1, 2, { message: 'wrong count' });
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const failure = firstAssertionFailure(outcome);
                scope.require.notNull(failure);
                scope.assert.equal(failure.checks[0].summary, 'wrong count');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() rejects pending async assertions from throwing test cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(function pendingAssertion(testScope) {
                    const pendingAssertions = [ testScope.assert.rejects(async function neverResolves() {
                        await Promise.race<never>([]);
                    }, { message: 'no rejection' }) ];

                    testScope.assert.equal(pendingAssertions.length, 1);
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
            title: 'execute() keeps require failures fatal in throwing test cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(
                    function failedRequirement(testScope: ThrowingTestScope) {
                        testScope.require.string(1, { message: 'required string' });
                    }
                );
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const failure = firstAssertionFailure(outcome);
                scope.require.notNull(failure);
                scope.assert.equal(failure.checks[0].source, 'require');
                scope.assert.equal(failure.checks[0].summary, 'required string');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() reports Node AssertionError values as assertion failures in throwing test cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(function nodeAssertFailure() {
                    assert.equal(1, 2, 'wrong count');
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const failure = firstAssertionFailure(outcome);
                scope.require.notNull(failure);
                assertNodeAssertionFailure(scope, failure);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'isNodeAssertionError() detects native and structural assertion errors only',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                scope.assert.equal(
                    isNodeAssertionError(
                        new AssertionError({
                            actual: 1,
                            expected: 2,
                            operator: 'strictEqual'
                        })
                    ),
                    true
                );
                scope.assert.equal(
                    isNodeAssertionError({
                        code: 'ERR_ASSERTION',
                        name: 'AssertionError'
                    }),
                    true
                );
                scope.assert.equal(isNodeAssertionError('boom'), false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() reports AssertionError values without stacks as assertion failures',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(function assertionErrorWithoutStack() {
                    const error = new AssertionError({
                        actual: 1,
                        expected: 2,
                        message: 'plain assertion',
                        operator: 'strictEqual'
                    });

                    Reflect.deleteProperty(error, 'stack');
                    throw error;
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const failure = firstAssertionFailure(outcome);
                scope.require.notNull(failure);
                assertUnknownNodeAssertionLocation(scope, failure);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'execute() keeps ordinary thrown errors as body errors in throwing test cases',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleThrowingBody(function bodyError() {
                    throw new Error('boom');
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const failure = outcome.failures[0];
                if (failure.kind !== 'body-error') {
                    scope.assert.equal(failure.kind, 'body-error');

                    return scope.assert.collect();
                }

                scope.assert.equal(failure.error.message, 'boom');

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
