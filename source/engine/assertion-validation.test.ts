import { suite, test } from '@overkill-dev/test';
import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import type { DeepEqualAssertionNode } from '../assertion-protocol/assertions/equality.ts';
import { executeEngineCase } from '../test-support/create-test-engine.ts';
import type { RunResult } from './run-result.ts';

const leaf: AssertAssertionNode = {
    actual: true,
    check: 'true',
    message: null,
    source: 'assert',
    sourceLocations: [ unknownSourceLocation ]
};

function failures(result: RunResult): readonly Extract<NonNullable<RunResult['perTest'][number]['outcome']>, {
    readonly kind: 'fail';
}>['failures'][number][] {
    const outcome = result.perTest[0]?.outcome;
    return outcome?.kind === 'fail' ? outcome.failures : [];
}

function malformedValues(): readonly unknown[] {
    const children: unknown[] = [];
    const composite = { ...leaf, check: 'composite', expected: true, name: 'cycle', summary: 'cycle', children };
    children.push(composite);
    const sparse: unknown[] = [ leaf, leaf ];
    Reflect.deleteProperty(sparse, 0);
    return [ composite, sparse, { ...leaf, source: 'require' }, { check: 'true' } ];
}

function cyclicOperand(): Readonly<Record<string, unknown>> {
    const value: Record<string, unknown> = {};
    value.self = value;
    return value;
}

function cyclicComparison(): DeepEqualAssertionNode<'assert'> {
    return { ...leaf, check: 'deep-equal', actual: cyclicOperand(), expected: cyclicOperand() };
}

export const testNode = suite('Assertion protocol validation', [
    test('rejects malformed assertion structure', async function (scope) {
        for (const malformed of malformedValues()) {
            const result = await executeEngineCase(function () {
                return malformed as AssertAssertionNode;
            });
            const [ failure ] = failures(result);
            scope.assert.equal(failures(result).length, 1);
            scope.assert.equal(failure?.kind === 'test-contract' ? failure.code : null, 'invalid-assertion-protocol');
            scope.assert.equal(result.runnerErrors.length, 0);
        }
        return scope.assert.collect();
    }),
    test('rejects protocol accessors without executing them', async function (scope) {
        let reads = 0;
        const result = await executeEngineCase(function () {
            return Object.defineProperty({ ...leaf }, 'check', {
                get() {
                    reads += 1;
                    return 'true';
                }
            });
        });
        const [ failure ] = failures(result);
        scope.assert.equal(failure?.kind === 'test-contract' ? failure.code : null, 'invalid-assertion-protocol');
        scope.assert.equal(reads, 0);
        return scope.assert.collect();
    }),
    test('rejects an accessor added to a collected builder assertion', async function (scope) {
        let reads = 0;
        const result = await executeEngineCase(function (body) {
            body.assert.true(true);
            const returned = body.assert.collect();
            Object.defineProperty(returned[0], 'actual', {
                get() {
                    reads += 1;
                    return true;
                }
            });
            return returned;
        });
        const [ failure ] = failures(result);
        scope.assert.equal(failure?.kind === 'test-contract' ? failure.code : null, 'invalid-assertion-protocol');
        scope.assert.equal(reads, 0);
        return scope.assert.collect();
    }),
    test('keeps malformed location providers lazy for passing cyclic comparisons', async function (scope) {
        let calls = 0;
        const node = cyclicComparison();
        const result = await executeEngineCase(function () {
            return {
                ...node,
                sourceLocations: [ function () {
                    calls += 1;
                    return { kind: 'known', file: '', line: null, column: null };
                } ]
            };
        });
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'pass');
        scope.assert.equal(calls, 0);
        return scope.assert.collect();
    }),
    test('rejects malformed metadata returned by a location provider on failure', async function (scope) {
        const result = await executeEngineCase(function () {
            return {
                ...leaf,
                actual: false,
                sourceLocations: [ function () {
                    return { kind: 'known', file: '', line: null, column: null };
                } ]
            };
        });
        const [ failure ] = failures(result);
        scope.assert.equal(failure?.kind === 'test-contract' ? failure.code : null, 'invalid-assertion-protocol');
        return scope.assert.collect();
    }),
    test('uses unknown location when a provider throws during a cyclic mismatch', async function (scope) {
        const result = await executeEngineCase(function () {
            return {
                ...cyclicComparison(),
                expected: {},
                sourceLocations: [ function () {
                    throw new Error('Unavailable location.');
                } ]
            };
        });
        const [ assertion ] = failures(result);
        scope.assert.equal(assertion?.kind, 'assertion');
        if (assertion?.kind === 'assertion') {
            scope.assert.deepEqual(assertion.checks[0].sourceLocations, [ unknownSourceLocation ]);
        }
        return scope.assert.collect();
    })
]);
