import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { FailedForeignCheck, FailedLeafCheck } from '../assertion-protocol/assertion-node-shape.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import type { Diff } from '../diff/diff-shape.ts';
import type { TestFailure } from '../engine/run-result.ts';
import { formatFailure } from './line-failure-rendering.ts';

function failedCheck(diff: Diff | null): FailedLeafCheck {
    return {
        actual: serializeValue(null),
        diff,
        expected: serializeValue(null),
        id: '1',
        kind: 'leaf',
        location: { column: 9, file: 'source/users.test.ts', line: 7 },
        path: [
            { kind: 'byte', offset: 3 },
            { key: { kind: 'string', truncation: null, value: 'id' }, kind: 'map-key' },
            { key: { kind: 'string', truncation: null, value: 'name' }, kind: 'map-value' }
        ],
        source: 'assert',
        summary: 'differs'
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/reporters/line-failure-rendering-edge.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'line failure formatter renders scalar serialized value variants',
            metadata: {},
            body(scope: OverkillScope) {
                const diff: Diff = {
                    actual: {
                        constructorName: 'Uint8Array',
                        kind: 'typed-array',
                        length: 1,
                        byteLength: 1,
                        bytes: [ 1 ],
                        truncation: null
                    },
                    expected: {
                        byteLength: 1,
                        bytes: [ 1 ],
                        kind: 'array-buffer',
                        truncation: null
                    },
                    kind: 'value'
                };
                const lines = formatFailure({ checks: [ failedCheck(diff) ], kind: 'assertion' });

                scope.assert.deepEqual(lines.slice(0, 5), [
                    'differs',
                    'path: [byte 3][map key "id"][map value "name"]',
                    'location: source/users.test.ts:7:9',
                    'expected: array-buffer(1 bytes)',
                    'actual: Uint8Array(1)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line failure formatter renders valid property paths and named functions',
            metadata: {},
            body(scope: OverkillScope) {
                const lines = formatFailure({
                    checks: [
                        {
                            ...failedCheck(null),
                            actual: serializeValue(function readUser() {
                                return null;
                            }),
                            expected: serializeValue(new Date('2026-07-29T00:00:00.000Z')),
                            path: [ { key: { kind: 'string', value: 'name' }, kind: 'property' } ]
                        }
                    ],
                    kind: 'assertion'
                });

                scope.assert.deepEqual(lines.slice(1, 5), [
                    'path: .name',
                    'location: source/users.test.ts:7:9',
                    'expected: Date 2026-07-29T00:00:00.000Z',
                    'actual: [Function readUser]'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line failure formatter renders foreign checks without diff data',
            metadata: {},
            body(scope: OverkillScope) {
                const check: FailedForeignCheck = {
                    actual: serializeValue('foreign assertion'),
                    diff: null,
                    error: {
                        message: 'failed',
                        name: 'AssertionError',
                        stack: null,
                        thrown: new Error('failed')
                    },
                    expected: serializeValue('foreign assertion pass'),
                    id: '1',
                    kind: 'foreign',
                    label: 'node assert',
                    location: { column: null, file: '', line: null },
                    path: [],
                    source: 'assert',
                    summary: 'foreign failed'
                };

                scope.assert.deepEqual(formatFailure({ checks: [ check ], kind: 'assertion' }), [
                    'foreign failed',
                    'foreign assertion: node assert',
                    'AssertionError: failed'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line failure formatter renders arrays, objects, maps, sets, and invalid dates',
            metadata: {},
            body(scope: OverkillScope) {
                const diff: Diff = {
                    actual: {
                        entries: [
                            { key: { kind: 'string', value: '0' }, value: { id: 1, kind: 'function', name: null } },
                            { key: { kind: 'string', value: '1' }, value: { kind: 'date', value: null } }
                        ],
                        kind: 'array',
                        length: 2,
                        truncation: null
                    },
                    expected: {
                        constructorName: 'Object',
                        entries: [
                            {
                                key: { kind: 'string', value: 'items' },
                                value: { kind: 'map', size: 0, entries: [], truncation: null }
                            },
                            {
                                key: { kind: 'symbol', value: 'Symbol(id)' },
                                value: { kind: 'set', size: 0, values: [], truncation: null }
                            }
                        ],
                        kind: 'object',
                        truncation: null
                    },
                    kind: 'value'
                };
                const lines = formatFailure({ checks: [ failedCheck(diff) ], kind: 'assertion' });

                scope.assert.equal(lines.at(-2), 'expected: Object { items: Map(0), [Symbol(id)]: Set(0) }');
                scope.assert.equal(lines.at(-1), 'actual: [[Function], Invalid Date]');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name:
                'line failure formatter renders regexp, errors, data views, circulars, opaque, and unavailable values',
            metadata: {},
            body(scope: OverkillScope) {
                const diff: Diff = {
                    kind: 'array',
                    operations: [
                        {
                            from: { flags: 'gu', kind: 'regexp', source: 'name' },
                            operation: 'replace',
                            path: [ { index: 0, kind: 'index' } ],
                            to: { entries: [], kind: 'error', message: 'boom', name: 'Error', truncation: null }
                        },
                        {
                            from: { byteLength: 1, bytes: [ 1 ], kind: 'data-view', truncation: null },
                            operation: 'replace',
                            path: [ { index: 1, kind: 'index' } ],
                            to: { kind: 'circular', reference: 1 }
                        },
                        {
                            from: { kind: 'opaque', type: 'weak-map' },
                            operation: 'replace',
                            path: [ { index: 2, kind: 'index' } ],
                            to: { kind: 'unavailable', reason: 'budget' }
                        }
                    ]
                };
                const lines = formatFailure({ checks: [ failedCheck(diff) ], kind: 'assertion' });

                scope.assert.true(lines.includes('replace [0]: expected /name/gu, actual Error: boom'));
                scope.assert.true(lines.includes('replace [1]: expected data-view(1 bytes), actual [Circular 1]'));
                scope.assert.true(lines.includes('replace [2]: expected [weak-map], actual [Unavailable: budget]'));

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'line failure formatter truncates long diff output by line count',
            metadata: {},
            body(scope: OverkillScope) {
                const failure: TestFailure = {
                    error: {
                        message: 'boom',
                        name: 'Error',
                        stack: Array
                            .from({ length: 120 }, function line(_unusedValue, index) {
                                return `line ${index}`;
                            })
                            .join('\n'),
                        thrown: new Error('boom')
                    },
                    kind: 'body-error'
                };
                const lines = formatFailure(failure);

                scope.assert.true(lines.some(function includesLineTruncation(line) {
                    return line.includes('truncated 20 lines');
                }));

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
