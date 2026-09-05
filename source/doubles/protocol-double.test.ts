import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
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

export const testSuite = createOverkillSuite({
    title: 'source/doubles/protocol-double.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'testIterator.yields() creates a well-formed consumable iterator',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const values = testIterator.yields([ 'a', 'b' ], 'done');

                scope.assert.equal(values[Symbol.iterator](), values);
                scope.assert.equal(typeof values.map, 'function');
                scope.assert.deepEqual(Array.from(values), [ 'a', 'b' ]);
                scope.assert.deepEqual(Array.from(values), []);
                scope.assert.equal(values.next.callCount, 4);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterator.yields() preserves tracked return values',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const values = testIterator.yields([ 'a', 'b' ], 'done');

                scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
                scope.assert.equal(values.return.callCount, 1);
                scope.assert.equal(values.next.callCount, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterable.yields() creates fresh well-formed iterators',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const source = testIterable.yields([ 'a', 'b' ]);

                scope.assert.deepEqual(Array.from(source), [ 'a', 'b' ]);
                scope.assert.deepEqual(Array.from(source), [ 'a', 'b' ]);
                scope.assert.equal(source[Symbol.iterator].callCount, 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterator() exposes programmable protocol methods',
            metadata: {},
            body: function body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            title: 'testIterator() creates default completed protocol methods',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const values = testIterator();

                scope.assert.deepEqual(values.next(), { done: true, value: undefined });
                scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
                scope.assert.throws(function throwIntoIterator() {
                    values.throw('expected');
                }, { exact: 'expected' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterator.yields() creates an async iterable iterator',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const values = testAsyncIterator.yields([ 'a', 'b' ], 'done');
                const seen: string[] = [];

                scope.assert.equal(values[Symbol.asyncIterator](), values);

                for await (const value of values) {
                    seen.push(value);
                }

                scope.assert.deepEqual(seen, [ 'a', 'b' ]);
                scope.assert.equal(values.next.callCount, 3);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterator() creates default completed protocol methods',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const values = testAsyncIterator();

                scope.assert.deepEqual(await values.next(), { done: true, value: undefined });
                scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
                await scope.assert.rejects(async function rejectValue() {
                    await values.throw('expected');
                }, { exact: 'expected' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterable.yields() creates fresh async iterators',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const source = testAsyncIterable.yields([ 'a', 'b' ]);
                const first = await asyncIterableValues(source);
                const second = await asyncIterableValues(source);

                scope.assert.deepEqual(first, [ 'a', 'b' ]);
                scope.assert.deepEqual(second, [ 'a', 'b' ]);
                scope.assert.equal(source[Symbol.asyncIterator].callCount, 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterable() creates default fresh iterators',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const source = testIterable();

                scope.assert.deepEqual(source[Symbol.iterator]().next(), { done: true, value: undefined });
                scope.assert.deepEqual(source[Symbol.iterator]().next(), { done: true, value: undefined });
                scope.assert.equal(source[Symbol.iterator].callCount, 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterable() creates default fresh async iterators',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const source = testAsyncIterable();

                scope.assert.deepEqual(await source[Symbol.asyncIterator]().next(), { done: true, value: undefined });
                scope.assert.deepEqual(await source[Symbol.asyncIterator]().next(), { done: true, value: undefined });
                scope.assert.equal(source[Symbol.asyncIterator].callCount, 2);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterable() exposes configured iterator factory',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const iterator = testIterator.yields([ 'configured' ]);
                const source = testIterable({
                    iterator: { fallback: rule.returns(iterator) }
                });

                scope.assert.deepEqual(Array.from(source), [ 'configured' ]);
                scope.assert.equal(source[Symbol.iterator].callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterable() exposes configured async iterator factory',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const iterator = testAsyncIterator.yields([ 'configured' ]);
                const source = testAsyncIterable({
                    asyncIterator: { fallback: rule.returns(iterator) }
                });
                const seen = await Array.fromAsync(source);

                scope.assert.deepEqual(seen, [ 'configured' ]);
                scope.assert.equal(source[Symbol.asyncIterator].callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterable.yieldsFrom() creates fresh delegated iterators',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const source = testIterable.yieldsFrom(function values() {
                    return [ 'a' ][Symbol.iterator]();
                });

                scope.assert.deepEqual(Array.from(source), [ 'a' ]);
                scope.assert.deepEqual(Array.from(source), [ 'a' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterable.yieldsFrom() creates fresh delegated async iterators',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const source = testAsyncIterable.yieldsFrom(async function* values() {
                    yield 'a';
                });
                const seen = await Array.fromAsync(source);

                scope.assert.deepEqual(seen, [ 'a' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testDisposable() records using disposal',
            metadata: {},
            body(scope: OverkillScope) {
                const resource = testDisposable();

                {
                    using value = resource;

                    scope.assert.equal(value, resource);
                }

                scope.assert.equal(resource.dispose.callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncDisposable() records await using disposal',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const resource = testAsyncDisposable();

                {
                    await using value = resource;

                    scope.assert.equal(value, resource);
                }

                scope.assert.equal(resource.asyncDispose.callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testDisposable() exposes programmable disposal',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const expected = new Error('expected');
                const resource = testDisposable({
                    dispose: { fallback: rule.throws(expected) }
                });

                scope.assert.throws(function disposeResource() {
                    resource.dispose();
                }, { exact: expected });
                scope.assert.equal(resource.dispose.callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncDisposable() exposes programmable async disposal',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const expected = new Error('expected');
                const resource = testAsyncDisposable({
                    asyncDispose: { fallback: rule.rejects(expected) }
                });

                await scope.assert.rejects(async function rejectValue() {
                    await resource.asyncDispose();
                }, { exact: expected });
                scope.assert.equal(resource.asyncDispose.callCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterator.yieldsFrom() delegates return and throw fallbacks',
            metadata: {},
            body: function body(scope: OverkillScope) {
                const values = testIterator.yieldsFrom(function source() {
                    return [ 'a', 'b' ][Symbol.iterator]();
                });

                scope.assert.deepEqual(values.next(), { done: false, value: 'a' });
                scope.assert.deepEqual(values.return('early'), { done: true, value: 'early' });
                scope.assert.throws(function throwIntoIterator() {
                    values.throw('expected');
                }, { exact: 'expected' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testIterator.yieldsFrom() delegates generator return and throw methods',
            metadata: {},
            body: function body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterator.yieldsFrom() delegates sync sources',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const values = testAsyncIterator.yieldsFrom(function source() {
                    return [ 'a' ][Symbol.iterator]();
                });

                scope.assert.deepEqual(await values.next(), { done: false, value: 'a' });
                scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
                await scope.assert.rejects(async function rejectValue() {
                    await values.throw('expected');
                }, { exact: 'expected' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterator.yieldsFrom() delegates async return fallback',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const values = testAsyncIterator.yieldsFrom(function source() {
                    return {
                        async next() {
                            return { done: false, value: 'a' };
                        }
                    };
                });

                scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testAsyncIterator.yieldsFrom() delegates async generator return and throw methods',
            metadata: {},
            body: async function body(scope: OverkillScope) {
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
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
