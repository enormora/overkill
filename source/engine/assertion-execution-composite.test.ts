import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import {
    defineCompositeAssertion,
    defineCompositeAssertion as definePublishedCompositeAssertion,
    defineNarrowingCompositeAssertion
} from '../packages/assert/assert.entry-point.ts';
import type {
    FailedCheck,
    FailedCompositeCheck,
    FailedForeignCheck,
    SourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { createTestEngine as createEngine } from '../test-support/create-test-engine.ts';
import type { AssertionTestFailure, FailOutcome, RunResult, TestContractFailure } from './run-result.ts';
import type { TestBody, TestScope } from './test-node.ts';

type BooleanResult = { readonly ok: boolean; };
type ValueResult = {
    readonly ok: boolean;
    readonly value: unknown;
};

type NarrowingOk = { readonly ok: true; readonly value: string; };
type NarrowingResult = NarrowingOk | { readonly ok: false; readonly error: Error; };

const narrowingResultOk = defineNarrowingCompositeAssertion({
    name: 'resultOk',
    narrows(result: NarrowingResult): result is NarrowingOk {
        return result.ok;
    }
});

const foreignFailureAssertion = defineCompositeAssertion({
    assert(check) {
        return check.fromThrowable('foreign.expectation', function failForeignExpectation() {
            throw new TypeError('wrong shape');
        });
    },
    name: 'throwsForeign'
});

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome?.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        title: 'case'
                    })
                ],
                metadata: {},
                title: 'root'
            })
        )
    );
}

function callUnknownFacade(target: unknown, parameters: readonly unknown[]): void {
    if (typeof target !== 'function') {
        throw new TypeError('Expected a callable facade.');
    }

    Reflect.apply(target, null, parameters);
}

function firstAssertionFailure(outcome: FailOutcome): AssertionTestFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'assertion') {
        return failure;
    }

    return null;
}

function firstContractFailure(outcome: FailOutcome): TestContractFailure | null {
    const failure = outcome.failures[0];

    if (failure.kind === 'test-contract') {
        return failure;
    }

    return null;
}

const capturedTestLocation = definePublishedCompositeAssertion({
    name: 'captured test location',
    assert(check, location: SourceLocation) {
        return check.group([
            check.match(
                location.file.replaceAll('\\', '/'),
                /source\/engine\/assertion-execution-composite\.test\.ts$/u
            ),
            check.equal(typeof location.line, 'number'),
            check.equal(typeof location.column, 'number')
        ]);
    }
});

function firstFailedCheck(outcome: FailOutcome): FailedCheck | null {
    return firstAssertionFailure(outcome)?.checks.at(0) ?? null;
}

function firstCompositeCheck(outcome: FailOutcome): FailedCompositeCheck | null {
    const check = firstFailedCheck(outcome);

    if (check?.kind === 'composite') {
        return check;
    }

    return null;
}

function compositeChildAt(composite: FailedCompositeCheck, index: number): FailedCheck | null {
    return composite.children[index] ?? null;
}

function firstForeignChild(outcome: FailOutcome): FailedForeignCheck | null {
    const composite = firstCompositeCheck(outcome);

    if (composite === null) {
        return null;
    }

    const child = compositeChildAt(composite, 0);

    if (child?.kind === 'foreign') {
        return child;
    }

    return null;
}

export const testSuite = createOverkillSuite({
    title: 'source/engine/assertion-execution-composite.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'execute() records callable composite assertion references as one planned boundary',
            metadata: {},
            async body(scope: OverkillScope) {
                const resultOk = defineCompositeAssertion({
                    assert(check, result: BooleanResult) {
                        return check.true(result.ok);
                    },
                    name: 'resultOk'
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.plan(1);
                    testScope.assert(resultOk, { ok: true });
                    testScope.assert.length([ 1, 2 ], 2);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);
                const outcome = firstFailOutcome(result);
                scope.require.notNull(outcome);
                scope.assert.deepEqual(outcome.failures, [
                    {
                        actual: 2,
                        code: 'plan-mismatch',
                        expected: '1',
                        kind: 'test-contract',
                        summary: 'Assertion plan count did not match.'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() reports composite parent failures with child diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const resultOk = defineCompositeAssertion({
                    assert(check, result: ValueResult, expected: unknown) {
                        return check.group([
                            check.annotated('status').true(result.ok),
                            check.annotated('value').deepEqual(result.value, expected)
                        ]);
                    },
                    formatSummary(context, result: ValueResult, expected: unknown) {
                        scope.assert.deepEqual(result, { ok: false, value: { count: 1 } });
                        scope.assert.deepEqual(expected, { count: 2 });
                        return `Expected ${context.name} to match.`;
                    },
                    name: 'resultOk'
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(resultOk, { ok: false, value: { count: 1 } }, { count: 2 });
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);
                scope.require.notNull(outcome);
                const composite = firstCompositeCheck(outcome);
                scope.require.notNull(composite);

                scope.assert(capturedTestLocation, composite.location);
                scope.assert.deepEqual(
                    composite.children.map(function toLocation(child) {
                        return child.location;
                    }),
                    [ composite.location, composite.location ]
                );

                scope.assert.deepEqual(outcome.failures, [
                    {
                        checks: [
                            {
                                actual: serializeValue({ ok: false, value: { count: 1 } }),
                                children: [
                                    {
                                        actual: serializeValue(false),
                                        diff: composite.children[0].diff,
                                        expected: serializeValue(true),
                                        id: '1.1',
                                        kind: 'leaf',
                                        location: composite.children[0].location,
                                        path: [],
                                        source: 'assert',
                                        summary: 'status'
                                    },
                                    {
                                        actual: serializeValue({ count: 1 }),
                                        diff: composite.children[1]?.diff,
                                        expected: serializeValue({ count: 2 }),
                                        id: '1.2',
                                        kind: 'leaf',
                                        location: composite.children[1]?.location,
                                        path: [ { key: { kind: 'string', value: 'count' }, kind: 'property' } ],
                                        source: 'assert',
                                        summary: 'value'
                                    }
                                ],
                                diff: null,
                                expected: serializeValue({ count: 2 }),
                                id: '1',
                                kind: 'composite',
                                location: composite.location,
                                path: [],
                                source: 'assert',
                                summary: 'Expected resultOk to match.'
                            }
                        ],
                        kind: 'assertion'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() records narrowing assertion references through assert',
            metadata: {},
            async body(scope: OverkillScope) {
                const isString = defineNarrowingCompositeAssertion({
                    name: 'isString',
                    narrows(value: unknown): value is string {
                        return typeof value === 'string';
                    }
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(isString, 'value');
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() rejects non-engine assertion references',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    callUnknownFacade(testScope.assert, [ 'not-reference' ]);
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);
                const failure = outcome === null ? null : firstContractFailure(outcome);

                scope.require.notNull(outcome);
                scope.require.notNull(failure);
                scope.assert.equal(failure.code, 'invalid-assertion-reference');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() rejects non-narrowing references through require',
            metadata: {},
            async body(scope: OverkillScope) {
                const reference = defineCompositeAssertion({
                    assert(check) {
                        return check.true(true);
                    },
                    name: 'custom'
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    callUnknownFacade(testScope.require, [ reference, 'value' ]);
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);
                const failure = outcome === null ? null : firstContractFailure(outcome);

                scope.require.notNull(outcome);
                scope.require.notNull(failure);
                scope.assert.equal(failure.code, 'invalid-require-reference');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() short-circuits failed narrowing assertion references through require',
            metadata: {},
            async body(scope: OverkillScope) {
                const error = new Error('boom');
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.plan(2);
                    const actual: NarrowingResult = { error, ok: false };

                    testScope.require(narrowingResultOk, actual);
                    testScope.assert.fail({ message: 'ignored' });
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);
                scope.require.notNull(outcome);
                const composite = firstCompositeCheck(outcome);
                scope.require.notNull(composite);

                scope.assert(capturedTestLocation, composite.location);
                scope.assert.deepEqual(
                    composite.children.map(function toLocation(child) {
                        return child.location;
                    }),
                    [ composite.location ]
                );

                scope.assert.deepEqual(outcome.failures, [
                    {
                        checks: [
                            {
                                actual: serializeValue({ error, ok: false }),
                                children: [
                                    {
                                        actual: serializeValue(false),
                                        diff: composite.children[0].diff,
                                        expected: serializeValue(true),
                                        id: '1.1',
                                        kind: 'leaf',
                                        location: composite.children[0].location,
                                        path: [],
                                        source: 'require',
                                        summary: 'Expected resultOk narrowing predicate to pass.'
                                    }
                                ],
                                diff: null,
                                expected: serializeValue('resultOk'),
                                id: '1',
                                kind: 'composite',
                                location: composite.location,
                                path: [],
                                source: 'require',
                                summary: 'Expected resultOk assertion to pass.'
                            }
                        ],
                        kind: 'assertion'
                    }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'execute() rejects unawaited async custom assertions at collect',
            metadata: {},
            async body(scope: OverkillScope) {
                const eventuallyOk = defineCompositeAssertion({
                    async assert(check) {
                        await Promise.resolve();
                        return check.true(true);
                    },
                    name: 'eventuallyOk'
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    const pendingAssertions = [ testScope.assert(eventuallyOk) ];

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
            title: 'execute() normalizes foreign bridge failures under the composite parent',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert.annotated('foreign failed')(foreignFailureAssertion);
                    return testScope.assert.collect();
                });
                const outcome = firstFailOutcome(result);

                scope.require.notNull(outcome);
                const composite = firstCompositeCheck(outcome);
                const child = firstForeignChild(outcome);
                scope.require.notNull(composite);
                scope.require.notNull(child);
                scope.assert.deepEqual(
                    {
                        childErrorMessage: child.error.message,
                        childErrorName: child.error.name,
                        childLabel: child.label,
                        childLocation: child.location,
                        compositeLocation: composite.location,
                        compositeSummary: composite.summary
                    },
                    {
                        childErrorMessage: 'wrong shape',
                        childErrorName: 'TypeError',
                        childLabel: 'foreign.expectation',
                        childLocation: composite.location,
                        compositeLocation: composite.location,
                        compositeSummary: 'foreign failed'
                    }
                );
                scope.assert(capturedTestLocation, composite.location);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
