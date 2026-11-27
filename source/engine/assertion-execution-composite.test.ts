import { type TestScope, suite, test } from '@overkill-dev/test';
import {
    defineCompositeAssertion,
    defineCompositeAssertion as definePublishedCompositeAssertion,
    defineNarrowingCompositeAssertion
} from '@overkill-dev/test/assert';
import {
    requireEngineNarrowingReference,
    requireEngineCompositeReference
} from '../test-support/assertion-reference-boundary.ts';
import { type EngineCaseBody, createTestEngine as createEngine } from '../test-support/create-test-engine.ts';

import type {
    FailedCheck,
    FailedCompositeCheck,
    FailedForeignCheck,
    SourceLocation
} from '../assertion-protocol/assertion-node-shape.ts';
import { defineCompositeAssertion as defineSubjectCompositeAssertion } from '../assert/assertion-extension.ts';
import type { BuiltInAssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import type { TrueAssertionNode } from '../assertion-protocol/assertions/boolean.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import { serializeValue } from '../compare/serialized-value.ts';

import type { AssertionTestFailure, FailOutcome, RunResult, TestContractFailure } from './run-result.ts';

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
requireEngineNarrowingReference(narrowingResultOk);

const foreignFailureAssertion = defineCompositeAssertion({
    assert(check) {
        return check.fromThrowable('foreign.expectation', function failForeignExpectation() {
            throw new TypeError('wrong shape');
        });
    },
    name: 'throwsForeign'
});
requireEngineCompositeReference(foreignFailureAssertion);

const borrowChild = defineCompositeAssertion({
    name: 'borrowed child',
    assert(_check, child: TrueAssertionNode<'assert'>) {
        return child;
    }
});
const borrowChildAsync = defineCompositeAssertion({
    name: 'borrowed async child',
    async assert(_check, child: TrueAssertionNode<'assert'>) {
        await Promise.resolve();
        return child;
    }
});
requireEngineCompositeReference(borrowChild);
requireEngineCompositeReference(borrowChildAsync);

function firstFailOutcome(result: RunResult): FailOutcome | null {
    const firstResult = result.perTest.at(0);

    if (firstResult?.outcome?.kind === 'fail') {
        return firstResult.outcome;
    }

    return null;
}

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
        if (location.kind === 'unknown') {
            return check.equal(location.kind, 'known');
        }

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
requireEngineCompositeReference(capturedTestLocation);

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

const asyncChild = defineSubjectCompositeAssertion({
    name: 'async diagnostic',
    async assert(check, value: number) {
        const foreign = await check.fromRejectable('async expectation', () => Promise.resolve());
        return check.group([ check.equal(value, 1), foreign ]);
    }
});

export const testNode = suite('Composite assertion execution', [
    test('owns parallel async custom diagnostics without adding plan units', async function (scope) {
        const result = await executeSingleBody(async function (body) {
            body.plan(2);
            await Promise.all([ body.assert(asyncChild, 1), body.assert(asyncChild, 1) ]);
            return body.assert.collect();
        });
        scope.assert.equal(result.summary.passed, 1);
        return scope.assert.collect();
    }),
    test('retains a caught captured facade violation across an await', async function (scope) {
        const result = await executeSingleBody(async function (body) {
            const recordOutside = body.assert.true;
            const reference = defineSubjectCompositeAssertion({
                name: 'captured facade',
                async assert(check) {
                    await Promise.resolve();
                    try {
                        recordOutside(true);
                    } catch {
                        return check.true(true);
                    }
                    return check.fail();
                }
            });
            body.plan(1);
            await body.assert(reference);
            return body.assert.collect();
        });
        scope.assert.deepEqual(
            firstFailOutcome(result)?.failures.map(function code(failure) {
                return failure.kind === 'test-contract' ? failure.code : failure.kind;
            }) ?? [],
            [ 'invalid-assertion-context' ]
        );
        return scope.assert.collect();
    }),
    test('rejects an injected diagnostic returned by a different invocation', async function (scope: TestScope) {
        const result = await executeSingleBody(function (body) {
            const retained: BuiltInAssertAssertionNode<'assert'>[] = [];
            const reference = defineSubjectCompositeAssertion({
                name: 'retained diagnostic',
                assert(check) {
                    const previous = retained[0];
                    if (previous !== undefined) {
                        return previous;
                    }
                    const diagnostic = check.true(true);
                    retained.push(diagnostic);
                    return diagnostic;
                }
            });
            body.assert(reference);
            body.assert(reference);
            return body.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        scope.require.notNull(outcome);
        scope.assert.equal(firstContractFailure(outcome)?.code, 'invalid-assertion-context');
        return scope.assert.collect();
    }),
    test(
        'records callable composite assertion references as one planned boundary',
        async function (scope: TestScope) {
            const resultOk = defineCompositeAssertion({
                assert(check, result: BooleanResult) {
                    return check.true(result.ok);
                },
                name: 'resultOk'
            });
            requireEngineCompositeReference(resultOk);
            const result = await executeSingleBody(function testBody(testScope) {
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
    ),
    test('reports composite parent failures with child diagnostics', async function (scope: TestScope) {
        const summaryArguments: (readonly [ValueResult, unknown])[] = [];
        const resultOk = defineCompositeAssertion({
            assert(check, result: ValueResult, expected: unknown) {
                return check.group([
                    check.annotated('status').true(result.ok),
                    check.annotated('value').deepEqual(result.value, expected)
                ]);
            },
            formatSummary(context, result: ValueResult, expected: unknown) {
                summaryArguments.push([ result, expected ]);
                return `Expected ${context.name} to match.`;
            },
            name: 'resultOk'
        });
        requireEngineCompositeReference(resultOk);
        const outcome = firstFailOutcome(
            await executeSingleBody(function testBody(testScope) {
                testScope.assert(resultOk, { ok: false, value: { count: 1 } }, { count: 2 });
                return testScope.assert.collect();
            })
        );
        scope.require.notNull(outcome);
        const composite = firstCompositeCheck(outcome);
        scope.require.notNull(composite);

        scope.assert.deepEqual(summaryArguments, [ [ { ok: false, value: { count: 1 } }, { count: 2 } ] ]);
        scope.assert(capturedTestLocation, composite.sourceLocations[0]);
        scope.assert.deepEqual(
            composite.children.map(function toLocation(child) {
                return child.sourceLocations[0];
            }),
            [ composite.sourceLocations[0], composite.sourceLocations[0] ]
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
                                sourceLocations: [ composite.children[0].sourceLocations[0] ],
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
                                sourceLocations: [ composite.children[1]?.sourceLocations[0] ],
                                path: [ { key: { kind: 'string', value: 'count' }, kind: 'property' } ],
                                source: 'assert',
                                summary: 'value'
                            }
                        ],
                        diff: null,
                        expected: serializeValue({ count: 2 }),
                        id: '1',
                        kind: 'composite',
                        sourceLocations: [ composite.sourceLocations[0] ],
                        path: [],
                        source: 'assert',
                        summary: 'Expected resultOk to match.'
                    }
                ],
                kind: 'assertion'
            }
        ]);

        return scope.assert.collect();
    }),
    test('records narrowing assertion references through assert', async function (scope) {
        const isString = defineNarrowingCompositeAssertion({
            name: 'isString',
            narrows(value: unknown): value is string {
                return typeof value === 'string';
            }
        });
        requireEngineNarrowingReference(isString);
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(isString, 'value');
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.passed, 1);

        return scope.assert.collect();
    }),
    test('rejects non-engine assertion references', async function (scope: TestScope) {
        const result = await executeSingleBody(function testBody(testScope) {
            callUnknownFacade(testScope.assert, [ 'not-reference' ]);
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        const failure = outcome === null ? null : firstContractFailure(outcome);

        scope.require.notNull(outcome);
        scope.require.notNull(failure);
        scope.assert.equal(failure.code, 'invalid-assertion-reference');

        return scope.assert.collect();
    }),
    test('rejects non-narrowing references through require', async function (scope: TestScope) {
        const reference = defineCompositeAssertion({
            assert(check) {
                return check.true(true);
            },
            name: 'custom'
        });
        requireEngineCompositeReference(reference);
        const result = await executeSingleBody(function testBody(testScope) {
            const testScopeRequire: typeof testScope.require = testScope.require;

            callUnknownFacade(testScopeRequire, [ reference, 'value' ]);
            return testScope.assert.collect();
        });
        const outcome = firstFailOutcome(result);
        const failure = outcome === null ? null : firstContractFailure(outcome);

        scope.require.notNull(outcome);
        scope.require.notNull(failure);
        scope.assert.equal(failure.code, 'invalid-require-reference');

        return scope.assert.collect();
    }),
    test(
        'short-circuits failed narrowing assertion references through require',
        async function (scope: TestScope) {
            const error = new Error('boom');
            const result = await executeSingleBody(function testBody(testScope) {
                const testScopeRequire: typeof testScope.require = testScope.require;

                testScope.plan(2);
                const actual: NarrowingResult = { error, ok: false };

                testScopeRequire(narrowingResultOk, actual);
                testScope.assert.fail({ message: 'ignored' });
                return testScope.assert.collect();
            });
            const outcome = firstFailOutcome(result);
            scope.require.notNull(outcome);
            const composite = firstCompositeCheck(outcome);
            scope.require.notNull(composite);

            scope.assert(capturedTestLocation, composite.sourceLocations[0]);
            scope.assert.deepEqual(
                composite.children.map(function toLocation(child) {
                    return child.sourceLocations[0];
                }),
                [ composite.sourceLocations[0] ]
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
                                    sourceLocations: [ composite.children[0].sourceLocations[0] ],
                                    path: [],
                                    source: 'require',
                                    summary: 'Expected resultOk narrowing predicate to pass.'
                                }
                            ],
                            diff: null,
                            expected: serializeValue('resultOk'),
                            id: '1',
                            kind: 'composite',
                            sourceLocations: [ composite.sourceLocations[0] ],
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
    ),
    test('rejects a recorded node used as a returned composite child', async function (scope: TestScope) {
        const result = await executeSingleBody(function (body) {
            body.assert.true(true);
            const [ child ] = body.assert.collect();
            if (child.check !== 'true') {
                throw new Error('Expected a recorded true assertion.');
            }
            return [ child, {
                actual: true,
                check: 'composite',
                children: [ child ],
                expected: true,
                message: null,
                name: 'borrowed child',
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ],
                summary: 'Borrowed child'
            } ];
        });
        const outcome = firstFailOutcome(result);
        const failure = outcome === null ? null : firstContractFailure(outcome);
        scope.assert.equal(outcome?.failures.length, 1);
        scope.assert.deepEqual([ failure?.code, failure?.actual ], [
            'invalid-returned-builder-assertion',
            'child-reuse'
        ]);
        return scope.assert.collect();
    }),
    test('retains child reuse failures from sync and async custom assertions', async function (scope: TestScope) {
        for (const asynchronous of [ false, true ]) {
            const result = await executeSingleBody(async function (body) {
                body.assert.true(true);
                const [ child ] = body.assert.collect();
                if (child.check !== 'true') {
                    throw new Error('Expected a recorded true assertion.');
                }
                const invoke = async function (): Promise<void> {
                    if (asynchronous) {
                        await body.assert(borrowChildAsync, child);
                    } else {
                        body.assert(borrowChild, child);
                    }
                };
                try {
                    await invoke();
                } catch (error: unknown) {
                    body.assert.instanceOf(error, Error);
                }
                return body.assert.collect();
            });
            const outcome = firstFailOutcome(result);
            const failure = outcome === null ? null : firstContractFailure(outcome);
            scope.assert.equal(outcome?.failures.length, 1);
            scope.assert.deepEqual([ failure?.code, failure?.actual ], [
                'invalid-returned-builder-assertion',
                'child-reuse'
            ]);
        }
        return scope.assert.collect();
    }),
    test('rejects unawaited async custom assertions at collect', async function (scope: TestScope) {
        const eventuallyOk = defineCompositeAssertion({
            async assert(check) {
                await Promise.resolve();
                return check.true(true);
            },
            name: 'eventuallyOk'
        });
        requireEngineCompositeReference(eventuallyOk);
        const pendingAssertions: Promise<void>[] = [];
        const result = await executeSingleBody(function testBody(testScope) {
            pendingAssertions.push(testScope.assert(eventuallyOk));
            return testScope.assert.collect();
        });
        scope.assert.equal(pendingAssertions.length, 1);
        const outcome = firstFailOutcome(result);

        scope.require.notNull(outcome);
        scope.assert.deepEqual(outcome.failures, [
            {
                actual: 'pending async assertion',
                code: 'pending-async-assertion',
                expected: 'all async assertions awaited before collect',
                kind: 'test-contract',
                summary: 'Async assertion must be awaited before scope.assert.collect().'
            },
            {
                actual: {
                    kind: 'late-assertion-activity',
                    closure: 'settled',
                    operation: 'finish an asynchronous assertion',
                    origin: {
                        case: result.perTest[0]?.id,
                        work: result.perTest[0]?.workId,
                        attempt: { index: 0 },
                        trial: null
                    }
                },
                code: 'late-assertion-activity',
                expected: 'an open assertion recording context',
                kind: 'test-contract',
                summary: 'Cannot finish an asynchronous assertion after the assertion context settled.'
            }
        ]);

        return scope.assert.collect();
    }),
    test(
        'normalizes foreign bridge failures under the composite parent',
        async function (scope: TestScope) {
            const result = await executeSingleBody(function testBody(testScope) {
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
                    childLocation: child.sourceLocations[0],
                    compositeLocation: composite.sourceLocations[0],
                    compositeSummary: composite.summary
                },
                {
                    childErrorMessage: 'wrong shape',
                    childErrorName: 'TypeError',
                    childLabel: 'foreign.expectation',
                    childLocation: composite.sourceLocations[0],
                    compositeLocation: composite.sourceLocations[0],
                    compositeSummary: 'foreign failed'
                }
            );
            scope.assert(capturedTestLocation, composite.sourceLocations[0]);

            return scope.assert.collect();
        }
    )
]);
