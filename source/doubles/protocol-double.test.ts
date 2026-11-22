import { suite, test } from '@overkill-dev/test';

import { rule } from './double-rule.ts';
import {
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testIterable,
    testIterator
} from './protocol-double.ts';

async function asyncIterableValues(source: AsyncIterable<string>): Promise<readonly string[]> {
    return await Array.fromAsync(source);
}

export const testNode = suite('Protocol double', [
    test('testIterator.yields() creates a well-formed consumable iterator', function body(scope) {
        const values = testIterator.yields([ 'a', 'b' ], 'done');

        scope.assert.equal(values[Symbol.iterator](), values);
        scope.assert.equal(typeof values.map, 'function');
        scope.assert.deepEqual(Array.from(values), [ 'a', 'b' ]);
        scope.assert.deepEqual(Array.from(values), []);
        scope.assert.equal(values.next.callCount, 4);

        return scope.assert.collect();
    }),
    test('testIterator.yields() preserves tracked return values', function body(scope) {
        const values = testIterator.yields([ 'a', 'b' ], 'done');

        scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
        scope.assert.equal(values.return.callCount, 1);
        scope.assert.equal(values.next.callCount, 0);

        return scope.assert.collect();
    }),
    test('testIterable.yields() creates fresh well-formed iterators', function body(scope) {
        const source = testIterable.yields([ 'a', 'b' ]);

        scope.assert.deepEqual(Array.from(source), [ 'a', 'b' ]);
        scope.assert.deepEqual(Array.from(source), [ 'a', 'b' ]);
        scope.assert.equal(source[Symbol.iterator].callCount, 2);

        return scope.assert.collect();
    }),
    test('testIterator() exposes programmable protocol methods', function body(scope) {
        const expected = new Error('expected');
        const values = testIterator<string, string>({
            next: { fallback: rule.returns({ done: false, value: 'configured' }) },
            return: { fallback: rule.returns({ done: true, value: 'returned' }) },
            throw: { fallback: rule.throws(expected) }
        });

        scope.assert.deepEqual(values.next(), { done: false, value: 'configured' });
        scope.assert.deepEqual(values.return(), { done: true, value: 'returned' });
        scope.assert.throws(function throwIntoIterator() {
            values.throw(expected);
        }, { exact: expected });
        scope.assert.equal(values.next.callCount, 1);
        scope.assert.equal(values.return.callCount, 1);
        scope.assert.equal(values.throw.callCount, 1);

        return scope.assert.collect();
    }),
    test('testIterator() creates default completed protocol methods', function body(scope) {
        const values = testIterator();

        scope.assert.deepEqual(values.next(), { done: true, value: undefined });
        scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
        scope.assert.throws(function throwIntoIterator() {
            values.throw('expected');
        }, { exact: 'expected' });

        return scope.assert.collect();
    }),
    test('testAsyncIterator.yields() creates an async iterable iterator', async function body(scope) {
        const values = testAsyncIterator.yields([ 'a', 'b' ], 'done');
        const seen: string[] = [];

        scope.assert.equal(values[Symbol.asyncIterator](), values);

        for await (const value of values) {
            seen.push(value);
        }

        scope.assert.deepEqual(seen, [ 'a', 'b' ]);
        scope.assert.equal(values.next.callCount, 3);

        return scope.assert.collect();
    }),
    test('testAsyncIterator() creates default completed protocol methods', async function body(scope) {
        const values = testAsyncIterator();

        scope.assert.deepEqual(await values.next(), { done: true, value: undefined });
        scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
        await scope.assert.rejects(async function rejectValue() {
            await values.throw('expected');
        }, { exact: 'expected' });

        return scope.assert.collect();
    }),
    test('testAsyncIterable.yields() creates fresh async iterators', async function body(scope) {
        const source = testAsyncIterable.yields([ 'a', 'b' ]);
        const first = await asyncIterableValues(source);
        const second = await asyncIterableValues(source);

        scope.assert.deepEqual(first, [ 'a', 'b' ]);
        scope.assert.deepEqual(second, [ 'a', 'b' ]);
        scope.assert.equal(source[Symbol.asyncIterator].callCount, 2);

        return scope.assert.collect();
    }),
    test('testIterable() creates default fresh iterators', function body(scope) {
        const source = testIterable();

        scope.assert.deepEqual(source[Symbol.iterator]().next(), { done: true, value: undefined });
        scope.assert.deepEqual(source[Symbol.iterator]().next(), { done: true, value: undefined });
        scope.assert.equal(source[Symbol.iterator].callCount, 2);

        return scope.assert.collect();
    }),
    test('testAsyncIterable() creates default fresh async iterators', async function body(scope) {
        const source = testAsyncIterable();

        scope.assert.deepEqual(await source[Symbol.asyncIterator]().next(), { done: true, value: undefined });
        scope.assert.deepEqual(await source[Symbol.asyncIterator]().next(), { done: true, value: undefined });
        scope.assert.equal(source[Symbol.asyncIterator].callCount, 2);

        return scope.assert.collect();
    }),
    test('testIterable() exposes configured iterator factory', function body(scope) {
        const iterator = testIterator.yields([ 'configured' ]);
        const source = testIterable({
            iterator: { fallback: rule.returns(iterator) }
        });

        scope.assert.deepEqual(Array.from(source), [ 'configured' ]);
        scope.assert.equal(source[Symbol.iterator].callCount, 1);

        return scope.assert.collect();
    }),
    test('testAsyncIterable() exposes configured async iterator factory', async function body(scope) {
        const iterator = testAsyncIterator.yields([ 'configured' ]);
        const source = testAsyncIterable({
            asyncIterator: { fallback: rule.returns(iterator) }
        });
        const seen = await Array.fromAsync(source);

        scope.assert.deepEqual(seen, [ 'configured' ]);
        scope.assert.equal(source[Symbol.asyncIterator].callCount, 1);

        return scope.assert.collect();
    }),
    test('testIterable.yieldsFrom() creates fresh delegated iterators', function body(scope) {
        const source = testIterable.yieldsFrom(function values() {
            return [ 'a' ][Symbol.iterator]();
        });

        scope.assert.deepEqual(Array.from(source), [ 'a' ]);
        scope.assert.deepEqual(Array.from(source), [ 'a' ]);

        return scope.assert.collect();
    }),
    test(
        'testAsyncIterable.yieldsFrom() creates fresh delegated async iterators',
        async function body(scope) {
            const source = testAsyncIterable.yieldsFrom(async function* values() {
                yield 'a';
            });
            const seen = await Array.fromAsync(source);

            scope.assert.deepEqual(seen, [ 'a' ]);

            return scope.assert.collect();
        }
    ),
    test('testDisposable() records using disposal', function (scope) {
        const resource = testDisposable();

        {
            using value = resource;

            scope.assert.equal(value, resource);
        }

        scope.assert.equal(resource.dispose.callCount, 1);

        return scope.assert.collect();
    }),
    test('testAsyncDisposable() records await using disposal', async function body(scope) {
        const resource = testAsyncDisposable();

        {
            await using value = resource;

            scope.assert.equal(value, resource);
        }

        scope.assert.equal(resource.asyncDispose.callCount, 1);

        return scope.assert.collect();
    }),
    test('testDisposable() exposes programmable disposal', function body(scope) {
        const expected = new Error('expected');
        const resource = testDisposable({
            dispose: { fallback: rule.throws(expected) }
        });

        scope.assert.throws(function disposeResource() {
            resource.dispose();
        }, { exact: expected });
        scope.assert.equal(resource.dispose.callCount, 1);

        return scope.assert.collect();
    }),
    test('testAsyncDisposable() exposes programmable async disposal', async function body(scope) {
        const expected = new Error('expected');
        const resource = testAsyncDisposable({
            asyncDispose: { fallback: rule.rejects(expected) }
        });

        await scope.assert.rejects(async function rejectValue() {
            await resource.asyncDispose();
        }, { exact: expected });
        scope.assert.equal(resource.asyncDispose.callCount, 1);

        return scope.assert.collect();
    }),
    test('testIterator.yieldsFrom() delegates return and throw fallbacks', function body(scope) {
        const values = testIterator.yieldsFrom(function source() {
            return [ 'a', 'b' ][Symbol.iterator]();
        });

        scope.assert.deepEqual(values.next(), { done: false, value: 'a' });
        scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
        scope.assert.throws(function throwIntoIterator() {
            values.throw('expected');
        }, { exact: 'expected' });

        return scope.assert.collect();
    }),
    test('testIterator.yieldsFrom() delegates generator return and throw methods', function body(scope) {
        const expected = new Error('expected');
        const values = testIterator.yieldsFrom(function* source() {
            yield 'a';
            return 'done';
        });

        scope.assert.deepEqual(values.next(), { done: false, value: 'a' });
        scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
        scope.assert.throws(function throwIntoIterator() {
            values.throw(expected);
        }, { exact: expected });

        return scope.assert.collect();
    }),
    test('testAsyncIterator.yieldsFrom() delegates sync sources', async function body(scope) {
        const values = testAsyncIterator.yieldsFrom(function source() {
            return [ 'a' ][Symbol.iterator]();
        });

        scope.assert.deepEqual(await values.next(), { done: false, value: 'a' });
        scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
        await scope.assert.rejects(async function rejectValue() {
            await values.throw('expected');
        }, { exact: 'expected' });

        return scope.assert.collect();
    }),
    test('testAsyncIterator.yieldsFrom() delegates async return fallback', async function body(scope) {
        const values = testAsyncIterator.yieldsFrom(function source() {
            return {
                async next() {
                    return { done: false, value: 'a' };
                }
            };
        });

        scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });

        return scope.assert.collect();
    }),
    test(
        'testAsyncIterator.yieldsFrom() delegates async generator return and throw methods',
        async function body(scope) {
            const expected = new Error('expected');
            const values = testAsyncIterator.yieldsFrom(async function* source() {
                yield 'a';
                return 'done';
            });

            scope.assert.deepEqual(await values.next(), { done: false, value: 'a' });
            scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
            await scope.assert.rejects(async function rejectValue() {
                await values.throw(expected);
            }, { exact: expected });

            return scope.assert.collect();
        }
    )
]);
