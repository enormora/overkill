import { runIfMain } from '#test-runner';
import { suite, test } from '../packages/test/test.entry-point.ts';
import {
    serializeValue,
    type TestOutcome,
    type TestScope,
    type RunResult,
    type PropertyInvocationEvidence
} from '../packages/engine/engine.entry-point.ts';
import { executePropertyNode, propertyExecutionDefaults } from '../test-support/property-execution.ts';
import { testNode as failurePaths } from './property-shrinking-errors.test.ts';
import { testNode as cancellation } from './property-cancellation.test.ts';
import { testNode as lifecycle } from './property-shrinking-lifecycle.test.ts';
import { property } from './property-authoring.ts';
import { gen } from './generators.ts';

function firstPropertyEvidence(result: RunResult): PropertyInvocationEvidence | null {
    return result.perTest[0]?.property?.invocations[0] ?? null;
}

function assertOriginalTarget(scope: TestScope, outcome: TestOutcome | null): void {
    scope.assert.equal(outcome?.kind, 'fail');
    if (outcome?.kind !== 'fail') {
        return;
    }
    const failure = outcome.failures[0];
    scope.assert.equal(failure.kind, 'assertion');
    if (failure.kind === 'assertion') {
        scope.assert.equal(failure.checks.length, 1);
        scope.assert.equal(failure.checks[0].summary, 'original target');
    }
}

export const testNode = suite('first failure shrinking', [
    failurePaths,
    lifecycle,
    cancellation,
    test('distinguishes exception classes with the same error name and throw site', async function (scope) {
        class OriginalFailureError extends Error {
            public constructor(message: string, options: Readonly<ErrorOptions> | undefined) {
                super(message, options);
                this.name = 'OriginalFailureError';
            }
        }
        class OtherFailureError extends Error {
            public constructor(message: string, options: Readonly<ErrorOptions> | undefined) {
                super(message, options);
                this.name = 'OtherFailureError';
            }
        }
        const result = await executePropertyNode(
            property({
                title: 'exception types',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value) {
                    const Failure = value < 100 ? OtherFailureError : OriginalFailureError;
                    const failure = new Failure('same message', undefined);
                    failure.name = 'Error';
                    throw failure;
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(
            JSON.stringify(firstPropertyEvidence(result)?.retained.input),
            JSON.stringify(serializeValue(100))
        );
        return scope.assert.collect();
    }),

    test('missing automatic identity retains the original input', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'unknown location',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test() {
                    calls += 1;
                    return {
                        check: 'fail',
                        source: 'assert',
                        message: 'unknown',
                        sourceLocations: [ { kind: 'unknown' } ]
                    };
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(calls, 1);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(
            firstPropertyEvidence(result)?.diagnostics[0]?.reason,
            'failure-identity-unavailable'
        );
        return scope.assert.collect();
    }),
    test('a stable key never replaces an assertion with a body error', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'distinct failure categories',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    sample.failureKey('same key');
                    if (value < 100) {
                        throw new TypeError('different category');
                    }
                    sample.assert.fail({ message: 'original assertion' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(
            JSON.stringify(firstPropertyEvidence(result)?.retained.input),
            JSON.stringify(serializeValue(100))
        );
        scope.assert.true(
            (firstPropertyEvidence(result)?.diagnostics ?? []).some(function unrelated(diagnostic) {
                return diagnostic.reason === 'unrelated-failure';
            })
        );
        return scope.assert.collect();
    }),

    test('matches the original check behind an earlier unrelated check', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'recording order',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    if (value < 100) {
                        sample.assert.fail({ message: 'earlier unrelated check' });
                    }
                    sample.assert.fail({ message: 'original target' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        assertOriginalTarget(scope, result.perTest[0]?.outcome ?? null);
        scope.assert.equal(
            JSON.stringify(firstPropertyEvidence(result)?.retained.input),
            JSON.stringify(serializeValue(0))
        );
        return scope.assert.collect();
    }),
    test('bounds repeated mapped outputs and retains the established failure', async function (scope) {
        let calls = 0;
        const result = await executePropertyNode(
            property({
                title: 'repeated outputs',
                generator: gen.integer({ min: 1, max: 1000 }).map(function () {
                    return 1;
                }),
                settings: { maxShrinkWork: 30 },
                test(value, sample) {
                    calls += 1;
                    sample.assert.equal(value, 0);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.true(calls >= 2 && calls < 30);
        return scope.assert.collect();
    }),
    test('conflicting keys remain contract failures', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'conflicting keys',
                generator: gen.constant(1),
                test(_value, sample) {
                    sample.failureKey('first');
                    sample.failureKey('second');
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.includes(JSON.stringify(result.perTest[0]?.outcome), 'property-observation');
        return scope.assert.collect();
    }),

    test('retains the target while recording unrelated failures', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'threshold',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    seen.push(value);
                    if (value === 0) {
                        sample.assert.fail({ message: 'unrelated' });
                    }
                    sample.assert.true(value < 6);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(result.perTest.length, 1);
        scope.assert.equal(seen[0], 100);
        scope.assert.equal(seen[1], 100);
        const evidence = firstPropertyEvidence(result);
        scope.assert.equal(JSON.stringify(evidence?.retained.input), JSON.stringify(serializeValue(6)));
        scope.assert.true(
            evidence?.diagnostics.some(function unrelated(entry) {
                return entry.reason === 'unrelated-failure';
            }) === true
        );
        return scope.assert.collect();
    }),
    test('shrinks body errors without converting them to assertions', async function (scope) {
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'body error',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    seen.push(value);
                    if (value >= 6) {
                        throw new TypeError(`bad input ${value}`);
                    }
                    sample.assert.true(true);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        const outcome = result.perTest[0]?.outcome;
        scope.assert.equal(outcome?.kind, 'fail');
        if (outcome?.kind === 'fail') {
            scope.assert.true(outcome.failures.some(function bodyError(failure) {
                return failure.kind === 'body-error' && failure.error.message === 'bad input 6';
            }));
        }
        scope.assert.true(seen.length > 2);
        return scope.assert.collect();
    }),
    test('stable keys match different assertion locations', async function (scope) {
        const result = await executePropertyNode(
            property({
                title: 'semantic failure',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    sample.failureKey('semantic');
                    sample.failureKey('semantic');
                    if (value > 50) {
                        sample.assert.fail({ message: 'large' });
                    } else {
                        sample.assert.fail({ message: 'small' });
                    }
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        const outcome = result.perTest[0]?.outcome;
        scope.assert.equal(outcome?.kind, 'fail');
        scope.assert.equal(
            JSON.stringify(firstPropertyEvidence(result)?.retained.input),
            JSON.stringify(serializeValue(0))
        );
        return scope.assert.collect();
    }),
    test('confirmation disagreement retains the original failure', async function (scope) {
        let executions = 0;
        const result = await executePropertyNode(
            property({
                title: 'unstable',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(_value, sample) {
                    executions += 1;
                    sample.assert.equal(executions, 2);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.equal(executions, 2);
        scope.assert.equal(firstPropertyEvidence(result)?.diagnostics[0]?.reason, 'non-reproducible');
        return scope.assert.collect();
    }),
    test('final confirmation disagreement retains the shrunk failure and both observations', async function (scope) {
        let zeroCalls = 0;
        const seen: number[] = [];
        const result = await executePropertyNode(
            property({
                title: 'unstable final counterexample',
                generator: gen.integer({ min: 0, max: 100 }),
                examples: [ function () {
                    return 100;
                } ],
                test(value, sample) {
                    seen.push(value);
                    if (value === 0) {
                        zeroCalls += 1;
                    }
                    sample.assert.true(value === 0 && zeroCalls === 2);
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        const evidence = firstPropertyEvidence(result);
        scope.assert.equal(result.summary.failed, 1);
        scope.assert.deepEqual(seen, [ 100, 100, 0, 0 ]);
        scope.assert.equal(evidence?.shrinkStatus, 'non-reproducible');
        scope.assert.equal(JSON.stringify(evidence?.retained.input), JSON.stringify(serializeValue(0)));
        scope.assert.true(
            evidence?.diagnostics.some(function disagreement(diagnostic) {
                return diagnostic.reason === 'non-reproducible' && diagnostic.observation !== null;
            }) ?? false
        );
        return scope.assert.collect();
    }),
    test('disabled shrinking executes only the original input', async function (scope) {
        let executions = 0;
        const result = await executePropertyNode(
            property({
                title: 'disabled',
                generator: gen.integer({ min: 0, max: 100 }),
                settings: { maxShrinkWork: 0 },
                examples: [ function () {
                    return 100;
                } ],
                test(_value, sample) {
                    executions += 1;
                    sample.assert.fail({ message: 'failure' });
                    return sample.assert.collect();
                }
            }),
            propertyExecutionDefaults
        );
        scope.assert.equal(executions, 1);
        scope.assert.equal(result.summary.failed, 1);
        return scope.assert.collect();
    })
]);

await runIfMain(import.meta, testNode);
