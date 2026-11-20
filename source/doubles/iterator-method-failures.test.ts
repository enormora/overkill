import { type TestNode, table, type TestScope, suite, test } from '@overkill-dev/test';

import { testIterator, testAsyncIterator, testAsyncIterable } from './protocol-double.ts';
import { protocolIteratorEvents, protocolDisposeMethod } from './protocol-double-metadata.ts';

export const testNode: TestNode = suite('iterator method failure ownership', [
    table({
        title: 'records synchronous iterator failures',
        cases: [ 'next', 'return' ] as const,
        caseTitle(method) {
            return method;
        },
        test(scope) {
            const method = scope.parameters;

            const failure = new Error(method);
            const iterator = testIterator.yieldsFrom(function () {
                return {
                    next() {
                        throw failure;
                    },
                    return() {
                        throw failure;
                    }
                };
            });
            scope.assert.throws(function () {
                iterator[method]();
            }, { exact: failure });
            scope.assert.partialDeepEqual<unknown, unknown>(protocolIteratorEvents(iterator), [ {
                method,
                kind: 'throw',
                protocol: 'sync',
                thrown: failure
            } ]);
            return scope.assert.collect();
        }
    }),
    test(
        'records asynchronous return failure without losing the original error',
        async function (scope) {
            const failure = new Error('return');
            const iterator = testAsyncIterator.yieldsFrom(function () {
                return {
                    async next() {
                        return { done: false, value: 'next' };
                    },
                    async return() {
                        throw failure;
                    }
                };
            });
            await scope.assert.rejects(async function () {
                await iterator.return();
            }, { exact: failure });
            scope.assert.partialDeepEqual<unknown, unknown>(protocolIteratorEvents(iterator), [ {
                method: 'return',
                kind: 'throw',
                protocol: 'async',
                thrown: failure
            } ]);
            return scope.assert.collect();
        }
    ),
    test('records recovered asynchronous throw as a returned value', async function (scope) {
        const iterator = testAsyncIterator.yieldsFrom(function () {
            return {
                async next() {
                    return { done: false, value: 'next' };
                },
                async throw(error: unknown) {
                    return { done: true, value: error };
                }
            };
        });
        scope.assert.deepEqual(await iterator.throw('recovered'), { done: true, value: 'recovered' });
        scope.assert.partialDeepEqual<unknown, unknown>(protocolIteratorEvents(iterator), [ {
            method: 'throw',
            kind: 'return',
            protocol: 'async',
            value: 'recovered'
        } ]);
        return scope.assert.collect();
    }),
    test(
        'aggregates asynchronous iterable event history from its iterators',
        async function (scope) {
            const iterable = testAsyncIterable.yields([ 'first' ], 'done');
            const iterator = iterable[Symbol.asyncIterator]();
            scope.assert.equal(protocolDisposeMethod(iterable), null);
            scope.assert.deepEqual(await iterator.next(), { done: false, value: 'first' });
            scope.assert.deepEqual(await iterator.next(), { done: true, value: 'done' });
            scope.assert.partialDeepEqual<unknown, unknown>(protocolIteratorEvents(iterable), [ {
                kind: 'yield',
                value: 'first'
            }, { kind: 'return', value: 'done' } ]);
            return scope.assert.collect();
        }
    ),
    test('exposes the native synchronous iterator disposal protocol', function (scope: TestScope) {
        const iterator = testIterator.yields([ 'first' ], 'done');
        const dispose = protocolDisposeMethod(iterator);
        scope.require.defined(dispose);
        Reflect.apply(dispose, iterator, []);
        scope.assert.equal(iterator.return.callCount, 1);
        scope.assert.partialDeepEqual<unknown, unknown>(protocolIteratorEvents(iterator), [ {
            method: 'return',
            kind: 'return'
        } ]);
        return scope.assert.collect();
    })
]);
