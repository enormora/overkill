import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { collectionCount } from './collection-count.ts';
import { isPlainObject, ownKeys, partialDeepEqual } from './partial-matching.ts';

export const testSuite = createOverkillSuite({
    title: 'source/assertion-protocol/partial-matching.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'partialDeepEqual() matches nested partial arrays, maps, sets, and objects',
            metadata: {},
            body(scope: OverkillScope) {
                const symbolKey = Symbol('id');

                scope.assert.equal(partialDeepEqual([ { id: 1, name: 'Ada' } ], [ { id: 1 } ]), true);
                scope.assert.equal(
                    partialDeepEqual(
                        new Map([ [ { id: 1 }, { name: 'Ada', role: 'admin' } ] ]),
                        new Map([ [ { id: 1 }, { role: 'admin' } ] ])
                    ),
                    true
                );
                scope.assert.equal(partialDeepEqual(new Set([ { id: 1, name: 'Ada' } ]), new Set([ { id: 1 } ])), true);
                scope.assert.equal(partialDeepEqual({ [symbolKey]: 1, name: 'Ada' }, { [symbolKey]: 1 }), true);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'partialDeepEqual() rejects mismatched partial collection shapes',
            metadata: {},
            body(scope: OverkillScope) {
                scope.assert.equal(partialDeepEqual({ 0: 'value' }, [ 'value' ]), false);
                scope.assert.equal(partialDeepEqual({ id: 1 }, new Map([ [ 'id', 1 ] ])), false);
                scope.assert.equal(partialDeepEqual([ 1 ], new Set([ 1 ])), false);
                scope.assert.equal(partialDeepEqual([ 'value' ], { 0: 'value' }), false);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'collectionCount() reports known, iterable, and unsupported collection counts',
            metadata: {},
            body(scope: OverkillScope) {
                function* values(): Generator<number> {
                    yield 1;
                    yield 2;
                    yield 3;
                }

                scope.assert.deepEqual(collectionCount(new Map([ [ 'a', 1 ], [ 'b', 2 ] ]), 10), {
                    count: 2,
                    supported: true
                });
                scope.assert.deepEqual(collectionCount(values(), 2), {
                    count: 2,
                    supported: true
                });
                scope.assert.deepEqual(collectionCount(42, 10), {
                    count: 0,
                    supported: false
                });
                scope.assert.deepEqual(collectionCount(new Date('2026-08-21T00:00:00.000Z'), 10), {
                    count: 0,
                    supported: false
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'isPlainObject() and ownKeys() expose plain-object identity and keys',
            metadata: {},
            body(scope: OverkillScope) {
                const symbolKey = Symbol('id');
                const plainObject = Object.create(null) as Record<PropertyKey, unknown>;
                plainObject.name = 'Ada';
                plainObject[symbolKey] = 1;

                scope.assert.equal(isPlainObject(plainObject), true);
                scope.assert.equal(isPlainObject(new Date()), false);
                scope.assert.deepEqual(ownKeys(plainObject), [ 'name', symbolKey ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
