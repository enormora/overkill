import assert from 'node:assert/strict';
import type { FailedCompositeCheck, FailedLeafCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { compareDeepValues, compareStringEquality, serializedValueDiff } from '../compare/comparison.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import type { Diff } from '../diff/diff-shape.ts';
import type { TestFailure } from '../engine/run-result.ts';
import { registerTest } from '../test-support/register-test.ts';
import { formatFailure } from './line-failure-rendering.ts';

function failedCheck(overrides: Partial<FailedLeafCheck>): FailedLeafCheck {
    return {
        actual: serializeValue(1),
        diff: serializedValueDiff(1, 2),
        expected: serializeValue(2),
        id: '1',
        kind: 'leaf',
        location: { column: null, file: '', line: null },
        path: [],
        source: 'assert',
        summary: 'fails',
        ...overrides
    };
}

function assertionFailure(checks: readonly [FailedLeafCheck, ...FailedLeafCheck[]]): TestFailure {
    return { checks, kind: 'assertion' };
}

registerTest('line failure formatter renders serialized scalar values and locations', function () {
    const lines = formatFailure(assertionFailure([
        failedCheck({
            actual: serializeValue(undefined),
            diff: null,
            expected: serializeValue(null),
            location: { column: null, file: 'source/users.test.ts', line: null },
            path: [
                { index: 0, kind: 'index' },
                { key: { kind: 'string', value: 'display name' }, kind: 'property' }
            ],
            summary: 'null differs'
        }),
        failedCheck({
            actual: serializeValue(Symbol.for('actual')),
            diff: null,
            expected: serializeValue(1n),
            id: '2',
            location: { column: null, file: 'source/users.test.ts', line: 12 },
            summary: 'symbol differs'
        })
    ]));

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
    assert.equal(lines.at(-1), 'actual: Symbol.for(actual)');
});

registerTest('line failure formatter renders structured string hunks', function () {
    const comparison = compareStringEquality('Ada', 'Grace');
    const lines = formatFailure(assertionFailure([
        failedCheck({
            actual: comparison.actual,
            diff: comparison.diff,
            expected: comparison.expected,
            summary: 'names differ'
        })
    ]));

    assert.deepStrictEqual(lines, [
        'names differ',
        'string hunk expected 1, actual 1',
        '- Grace',
        '+ Ada'
    ]);
});

registerTest('line failure formatter renders object, array, map, and set diffs', function () {
    const objectComparison = compareDeepValues({ id: 1, name: 'Grace' }, { id: 1, name: 'Ada' });
    const arrayComparison = compareDeepValues([ 1, 3 ], [ 1, 2 ]);
    const mapComparison = compareDeepValues(new Map([ [ 'id', 2 ] ]), new Map([ [ 'id', 1 ] ]));
    const setComparison = compareDeepValues(new Set([ 2 ]), new Set([ 1 ]));
    const lines = formatFailure(assertionFailure([
        failedCheck({
            actual: objectComparison.actual,
            diff: objectComparison.diff,
            expected: objectComparison.expected,
            summary: 'object differs'
        }),
        failedCheck({
            actual: arrayComparison.actual,
            diff: arrayComparison.diff,
            expected: arrayComparison.expected,
            summary: 'array differs'
        }),
        failedCheck({
            actual: mapComparison.actual,
            diff: mapComparison.diff,
            expected: mapComparison.expected,
            summary: 'map differs'
        }),
        failedCheck({
            actual: setComparison.actual,
            diff: setComparison.diff,
            expected: setComparison.expected,
            summary: 'set differs'
        })
    ]));

    assert.ok(lines.includes('replace .name: expected "Ada", actual "Grace"'));
    assert.ok(lines.includes('replace [1]: expected 2, actual 3'));
    assert.ok(lines.some(function includesMapChange(line) {
        return line.startsWith('replace [map value ');
    }));
    assert.ok(lines.includes('remove [set 1]: 1'));
});

registerTest('line failure formatter renders binary diff summaries', function () {
    const actualBytes = new Uint8Array(101);
    const expectedBytes = new Uint8Array(101);
    actualBytes.fill(2);
    expectedBytes.fill(1);

    const binaryComparison = compareDeepValues(actualBytes, expectedBytes);
    const lines = formatFailure(assertionFailure([
        failedCheck({
            actual: binaryComparison.actual,
            diff: binaryComparison.diff,
            expected: binaryComparison.expected,
            summary: 'binary differs'
        })
    ]));

    assert.ok(lines.some(function includesBinarySummary(line) {
        return line.startsWith('binary differs: expected 101 bytes ');
    }));
});

registerTest('line failure formatter renders composite children', function () {
    const child = failedCheck({
        actual: serializeValue(false),
        diff: null,
        expected: serializeValue(true),
        summary: 'child detail'
    });
    const composite: FailedCompositeCheck = {
        actual: serializeValue({ ok: false }),
        children: [ child ],
        diff: null,
        expected: serializeValue('resultOk'),
        id: '1',
        kind: 'composite',
        location: { column: null, file: '', line: null },
        path: [],
        source: 'assert',
        summary: 'Expected resultOk assertion to pass.'
    };

    assert.deepStrictEqual(formatFailure({ checks: [ composite ], kind: 'assertion' }), [
        'Expected resultOk assertion to pass.',
        'expected: "resultOk"',
        'actual: Object { ok: false }',
        'child check 1',
        '  child detail',
        '  expected: true',
        '  actual: false'
    ]);
});

registerTest('line failure formatter renders body errors and test-contract failures', function () {
    const failure: TestFailure = {
        error: {
            message: 'boom',
            name: 'Error',
            stack: null,
            thrown: new Error('boom')
        },
        kind: 'body-error'
    };
    const contract: TestFailure = {
        actual: 0,
        code: 'no-assertions',
        expected: 'at least one assertion',
        kind: 'test-contract',
        summary: 'Expected at least one assertion.'
    };

    assert.deepStrictEqual(formatFailure(failure), [ 'Error: boom' ]);
    assert.deepStrictEqual(formatFailure(contract), [
        'Expected at least one assertion. (no-assertions)',
        'expected: at least one assertion',
        'actual: 0'
    ]);
});

registerTest('line failure formatter truncates oversized rendered values', function () {
    const diff: Diff = {
        actual: serializeValue('x'.repeat(9000)),
        expected: serializeValue('y'),
        kind: 'value'
    };
    const lines = formatFailure(assertionFailure([
        failedCheck({
            actual: diff.actual,
            diff,
            expected: diff.expected,
            summary: 'large value differs'
        })
    ]));

    assert.ok(lines.some(function includesTruncationMarker(line) {
        return line.includes('truncated after');
    }));
});
