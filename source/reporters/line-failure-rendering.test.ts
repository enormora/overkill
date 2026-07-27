import assert from 'node:assert/strict';
import type { FailedCheck } from '../assertion-protocol/assertion-node-shape.ts';
import type { TestFailure } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
import { formatFailure } from './line-failure-rendering.ts';

function failedCheck(overrides: Partial<FailedCheck>): FailedCheck {
    return {
        actual: 1,
        expected: 2,
        id: '1',
        location: { column: null, file: '', line: null },
        path: [],
        source: 'assert',
        summary: 'fails',
        ...overrides
    };
}

registerTest('line failure formatter renders multiple check labels and scalar values', function () {
    const lines = formatFailure({
        checks: [
            {
                actual: undefined,
                expected: null,
                id: '1',
                location: { column: null, file: 'source/users.test.ts', line: null },
                path: [ 0, 'display name' ],
                source: 'assert',
                summary: 'null differs'
            },
            {
                actual: Symbol.for('actual'),
                expected: 1n,
                id: '2',
                location: { column: null, file: 'source/users.test.ts', line: 12 },
                path: [],
                source: 'assert',
                summary: 'symbol differs'
            }
        ],
        kind: 'assertion'
    });

    assert.deepStrictEqual(lines.slice(0, 10), [
        'check 1',
        'null differs',
        'path: [0]["display name"]',
        'location: source/users.test.ts',
        'expected: null',
        'actual: undefined',
        'check 2',
        'symbol differs',
        'location: source/users.test.ts:12',
        'expected: 1n'
    ]);
    assert.equal(lines.at(-1), 'actual: Symbol(actual)');
});

registerTest('line failure formatter renders collection shallow hints', function () {
    const lines = formatFailure({
        checks: [
            failedCheck({ actual: [ 1 ], expected: [ 1, 2 ], summary: 'array length differs' }),
            failedCheck({ actual: [ 1 ], expected: [ 1 ], summary: 'array references differ' }),
            failedCheck({
                actual: { extra: 3, same: 2 },
                expected: { missing: 1, same: 2 },
                summary: 'object keys differ'
            }),
            failedCheck({ actual: [ 1 ], expected: { 0: 1 }, summary: 'types differ' })
        ],
        kind: 'assertion'
    });

    assert.ok(lines.includes('reference differs; array lengths differ: expected 2, actual 1'));
    assert.ok(lines.includes('reference differs; shallow contents match'));
    assert.ok(lines.includes('reference differs; shallow differences: missing missing, extra extra'));
    assert.ok(lines.includes('reference differs; value types differ'));
});

registerTest('line failure formatter renders equal string diagnostics without normalization note', function () {
    const lines = formatFailure({
        checks: [
            failedCheck({
                actual: 'same',
                expected: 'same',
                summary: 'strings differ'
            })
        ],
        kind: 'assertion'
    });

    assert.deepStrictEqual(lines, [
        'strings differ',
        'first difference at code unit 0',
        'expected (4 code units): "same"',
        'actual (4 code units):   "same"'
    ]);
});

registerTest('line failure formatter renders body errors without stacks', function () {
    const failure: TestFailure = {
        error: {
            message: 'boom',
            name: 'Error',
            stack: null,
            thrown: new Error('boom')
        },
        kind: 'body-error'
    };

    assert.deepStrictEqual(formatFailure(failure), [ 'Error: boom' ]);
});

registerTest('line failure formatter truncates oversized rendered values', function () {
    const lines = formatFailure({
        checks: [
            failedCheck({
                actual: { value: 'x'.repeat(9000) },
                expected: { value: 'y' },
                summary: 'large value differs'
            })
        ],
        kind: 'assertion'
    });

    assert.ok(lines.some(function includesTruncationMarker(line) {
        return line.includes('truncated after');
    }));
});
