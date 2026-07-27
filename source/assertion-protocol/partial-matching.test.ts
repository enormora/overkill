import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { collectionCount } from './collection-count.ts';
import { isPlainObject, ownKeys, partialDeepEqual } from './partial-matching.ts';

registerTest('partialDeepEqual() matches nested partial arrays, maps, sets, and objects', function () {
    const symbolKey = Symbol('id');

    assert.equal(partialDeepEqual([ { id: 1, name: 'Ada' } ], [ { id: 1 } ]), true);
    assert.equal(
        partialDeepEqual(
            new Map([ [ { id: 1 }, { name: 'Ada', role: 'admin' } ] ]),
            new Map([ [ { id: 1 }, { role: 'admin' } ] ])
        ),
        true
    );
    assert.equal(partialDeepEqual(new Set([ { id: 1, name: 'Ada' } ]), new Set([ { id: 1 } ])), true);
    assert.equal(partialDeepEqual({ [symbolKey]: 1, name: 'Ada' }, { [symbolKey]: 1 }), true);
});

registerTest('partialDeepEqual() rejects mismatched partial collection shapes', function () {
    assert.equal(partialDeepEqual({ 0: 'value' }, [ 'value' ]), false);
    assert.equal(partialDeepEqual({ id: 1 }, new Map([ [ 'id', 1 ] ])), false);
    assert.equal(partialDeepEqual([ 1 ], new Set([ 1 ])), false);
    assert.equal(partialDeepEqual([ 'value' ], { 0: 'value' }), false);
});

registerTest('collectionCount() reports known, iterable, and unsupported collection counts', function () {
    function* values(): Generator<number> {
        yield 1;
        yield 2;
        yield 3;
    }

    assert.deepStrictEqual(collectionCount(new Map([ [ 'a', 1 ], [ 'b', 2 ] ]), 10), {
        count: 2,
        supported: true
    });
    assert.deepStrictEqual(collectionCount(values(), 2), {
        count: 2,
        supported: true
    });
    assert.deepStrictEqual(collectionCount(42, 10), {
        count: 0,
        supported: false
    });
});

registerTest('isPlainObject() and ownKeys() expose plain-object identity and keys', function () {
    const symbolKey = Symbol('id');
    const plainObject = Object.create(null) as Record<PropertyKey, unknown>;
    plainObject.name = 'Ada';
    plainObject[symbolKey] = 1;

    assert.equal(isPlainObject(plainObject), true);
    assert.equal(isPlainObject(new Date()), false);
    assert.deepStrictEqual(ownKeys(plainObject), [ 'name', symbolKey ]);
});
