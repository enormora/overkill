import { types } from 'node:util';
import { runInNewContext } from 'node:vm';
import { type TestScope, suite, test } from '@overkill-dev/test';
import type { AssertAssertionNode } from '../assertion-protocol/assertion-node.ts';
import { unknownSourceLocation } from '../assertion-protocol/source-location.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import { executeEngineCase } from '../test-support/create-test-engine.ts';
import type { AssertionTestFailure, RunResult } from './run-result.ts';

function assertionFailure(result: RunResult): AssertionTestFailure {
    const outcome = result.perTest[0]?.outcome;
    if (outcome?.kind !== 'fail' || outcome.failures[0].kind !== 'assertion') {
        throw new Error('Expected the assertion to fail.');
    }
    return outcome.failures[0];
}

export const testNode = suite('Assertion-time operand meaning', [
    test('uses assertion-time operands for verdicts and failure diagnostics', async function (scope: TestScope) {
        const result = await executeEngineCase(function body(testScope) {
            const actual = { active: false };
            const expected = { active: true };
            testScope.plan(3);
            testScope.assert.deepEqual(actual, { active: false });
            testScope.assert.deepEqual(actual, expected);
            actual.active = true;
            testScope.assert.deepEqual(actual, expected);
            testScope.cleanup(function mutateExpected() {
                expected.active = false;
            });
            return testScope.assert.collect();
        });
        const failure = assertionFailure(result);
        const [ check ] = failure.checks;
        scope.assert.length(failure.checks, 1);
        scope.assert.equal(check.id, '2');
        scope.assert.deepEqual(check.actual, serializeValue({ active: false }));
        scope.assert.deepEqual(check.expected, serializeValue({ active: true }));
        scope.assert.equal(check.diff?.kind, 'object');
        return scope.assert.collect();
    }),
    test('compares cyclic operands beyond diagnostic entry limits', async function (scope: TestScope) {
        const result = await executeEngineCase(function body(testScope) {
            const actual: unknown[] = Array.from({ length: 101 }, function zero() {
                return 0;
            });
            const expected = [ ...actual, 2 ];
            actual[0] = actual;
            actual.push(1);
            expected[0] = expected;
            testScope.assert.deepEqual(actual, expected);
            actual[101] = 2;
            testScope.assert.deepEqual(actual, expected);
            return testScope.assert.collect();
        });
        const failure = assertionFailure(result);
        scope.assert.length(failure.checks, 1);
        scope.assert.equal(failure.checks[0].id, '1');
        return scope.assert.collect();
    }),
    test('observes rejection matchers at settlement', async function (scope: TestScope) {
        const result = await executeEngineCase(async function body(testScope) {
            const pattern = /x/uy;
            const pending = testScope.assert.rejects(
                async function reject() {
                    throw new Error(' x');
                },
                { message: pattern }
            );
            pattern.lastIndex = 1;
            await pending;
            pattern.lastIndex = 2;
            return testScope.assert.collect();
        });
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'pass');
        return scope.assert.collect();
    }),
    test('uses final operands for directly returned nodes', async function (scope: TestScope) {
        const result = await executeEngineCase(function body() {
            const actual = { active: false };
            const node: AssertAssertionNode = {
                actual,
                check: 'deep-equal',
                expected: { active: true },
                message: null,
                source: 'assert',
                sourceLocations: [ unknownSourceLocation ]
            };
            actual.active = true;
            return node;
        });
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'pass');
        return scope.assert.collect();
    }),
    test('uses native regexp starting positions without advancing caller state', async function (scope: TestScope) {
        const result = await executeEngineCase(function body(testScope) {
            const stickyPattern: unknown = runInNewContext('/x/uy');
            if (!types.isRegExp(stickyPattern)) {
                throw new TypeError('Expected a cross-realm regular expression.');
            }
            for (const pattern of [ /x/gu, stickyPattern ]) {
                pattern.lastIndex = 1;
                testScope.assert.match(' x', pattern);
                testScope.assert.notMatch('  ', pattern);
                testScope.assert.equal(pattern.lastIndex, 1);
                pattern.lastIndex = 2;
            }
            return testScope.assert.collect();
        });
        scope.assert.equal(result.perTest[0]?.outcome?.kind, 'pass');
        return scope.assert.collect();
    })
]);
