import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { defineCompositeAssertion as definePublishedCompositeAssertion } from '@overkill-dev/assert';
import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type {
    FailedCheck,
    SourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { AssertionTestFailure, FailOutcome, RunResult } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createSuite({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        name: 'case'
                    })
                ],
                metadata: {},
                name: 'root'
            })
        )
    );
}

function firstAssertionFailure(outcome: FailOutcome): AssertionTestFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        return failure;
    }

    return null;
}

const capturedTestLocation = definePublishedCompositeAssertion({
    name: 'captured test location',
    assert(check, location: SourceLocation) {
        return check.group([
            check.match(location.file.replaceAll('\\', '/'), /source\/engine\/assertion-execution\.test\.ts$/u),
            check.equal(typeof location.line, 'number'),
            check.equal(typeof location.column, 'number')
        ]);
    }
});

function firstFailedCheck(outcome: FailOutcome): FailedCheck | null {
    return firstAssertionFailure(outcome)?.checks.at(0) ?? null;
}

export const testSuite = createOverkillSuite({
    name: 'source/engine/assertion-execution.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'execute() counts successful requirements once a returned assertion result exists',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.plan(2);
                    testScope.require.string('value');
                    testScope.assert.true(true);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() rejects successful require-only builder collection',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.require.string('value');
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                scope.assert.deepEqual(outcome.failures, [
                    {
                        actual: 0,
                        code: 'no-assertions',
                        expected: 'at least one assertion',
                        kind: 'test-contract',
                        summary: 'Expected at least one assertion.'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() skips plan mismatch when a requirement fails',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.plan(2);
                    testScope.require.string(1, { message: 'required string' });
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const check = firstFailedCheck(outcome);
                scope.require.notNull(check);
                scope.assert(capturedTestLocation, check.location);

                scope.assert.deepEqual(outcome.failures, [
                    {
                        checks: [
                            {
                                actual: serializeValue(1),
                                diff: null,
                                expected: serializeValue('string'),
                                id: '1',
                                kind: 'leaf',
                                location: check.location,
                                path: [],
                                source: 'require',
                                summary: 'required string'
                            }
                        ],
                        kind: 'assertion'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() treats caught failed requirements as fatal and ignores later assertions',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    try {
                        testScope.require.string(1, { message: 'required string' });
                    } catch {
                        testScope.assert.fail({ message: 'ignored failure' });
                    }

                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const check = firstFailedCheck(outcome);
                scope.require.notNull(check);
                scope.assert(capturedTestLocation, check.location);

                scope.assert.deepEqual(outcome.failures, [
                    {
                        checks: [
                            {
                                actual: serializeValue(1),
                                diff: null,
                                expected: serializeValue('string'),
                                id: '1',
                                kind: 'leaf',
                                location: check.location,
                                path: [],
                                source: 'require',
                                summary: 'required string'
                            }
                        ],
                        kind: 'assertion'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() rejects returned results that drop recorded builder assertions',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope) {
                    const replacement: AssertAssertionNode = {
                        actual: true,
                        check: 'true',
                        location: unknownSourceLocation,
                        message: null,
                        source: 'assert'
                    };

                    testScope.assert.true(true);

                    return [ replacement ];
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                scope.assert.deepEqual(outcome.failures, [
                    {
                        actual: 'missing recorded builder assertion',
                        code: 'dead-builder-assertion',
                        expected: 'returned assertions include every recorded builder assertion',
                        kind: 'test-contract',
                        summary: 'Returned assertions must include every recorded builder assertion.'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() accepts appended direct assertions around builder assertions',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope) {
                    const leading: AssertAssertionNode = {
                        actual: true,
                        check: 'true',
                        location: unknownSourceLocation,
                        message: null,
                        source: 'assert'
                    };
                    const trailing: AssertAssertionNode = {
                        actual: false,
                        check: 'false',
                        location: unknownSourceLocation,
                        message: null,
                        source: 'assert'
                    };

                    testScope.plan(3);
                    testScope.assert.true(true);

                    return [ leading, ...testScope.assert.collect(), trailing ];
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'execute() merges successful requirements by timeline for counts and check ids',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.plan(3);
                    testScope.assert.equal(1, 2, { message: 'first assert' });
                    testScope.require.string('value');
                    testScope.assert.equal(3, 4, { message: 'second assert' });
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                scope.assert.deepEqual(
                    outcome.failures.flatMap(function failedChecks(failure) {
                        return failure.kind === 'assertion'
                            ? failure.checks.map(function toCheck(check) {
                                return { id: check.id, summary: check.summary };
                            })
                            : [];
                    }),
                    [
                        { id: '1', summary: 'first assert' },
                        { id: '3', summary: 'second assert' }
                    ]
                );

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
