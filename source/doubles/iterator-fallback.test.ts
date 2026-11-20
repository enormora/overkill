import { type TestNode, suite, test } from '@overkill-dev/test';

import { createHistoryStore } from './double-history-store.ts';
import { createSyncTrackedIterator, createAsyncTrackedIterator } from './double-iterator-tracking.ts';

const invocation = { kind: 'call', index: 0, arguments: [] } as const;
export const testNode: TestNode = suite('iterator protocol fallbacks', [
    test('provides return and throw for synchronous sources without those methods', function (scope) {
        const store = createHistoryStore(function () {
            return undefined;
        });
        const values = createSyncTrackedIterator(store, invocation, function () {
            return {
                next() {
                    return { done: false, value: 42 };
                }
            };
        });
        scope.assert.equal(values[Symbol.iterator](), values);
        scope.assert.deepEqual<unknown, unknown>(values.next(), { done: false, value: 42 });
        scope.assert.deepEqual<unknown, unknown>(values.return?.('early'), { done: true, value: 'early' });
        const failure = new Error('Stop iterator.');
        scope.assert.throws(function () {
            return values.throw?.(failure);
        }, { exact: failure });
        scope.assert.deepEqual<unknown, unknown>(
            store.iteratorEvents.map(function (event) {
                return event.kind;
            }),
            [
                'yield',
                'return',
                'throw'
            ]
        );
        return scope.assert.collect();
    }),
    test('provides return and throw for asynchronous sources without those methods', async function (scope) {
        const store = createHistoryStore(function () {
            return undefined;
        });
        const values = createAsyncTrackedIterator(store, invocation, function () {
            return {
                async next() {
                    return { done: false, value: 42 };
                }
            };
        });
        scope.assert.equal(values[Symbol.asyncIterator](), values);
        scope.assert.deepEqual<unknown, unknown>(await values.next(), { done: false, value: 42 });
        scope.assert.deepEqual<unknown, unknown>(await values.return?.('early'), { done: true, value: 'early' });
        const failure = new Error('Stop iterator.');
        await scope.assert.rejects(async function () {
            return values.throw?.(failure);
        }, { exact: failure });
        scope.assert.deepEqual<unknown, unknown>(
            store.iteratorEvents.map(function (event) {
                return event.kind;
            }),
            [
                'yield',
                'return',
                'throw'
            ]
        );
        return scope.assert.collect();
    }),
    test('keeps old synchronous iterators functional after recording resets', function (scope) {
        const store = createHistoryStore(function () {
            return undefined;
        });
        const values = createSyncTrackedIterator(store, invocation, function () {
            return {
                next() {
                    return { done: false, value: 42 };
                }
            };
        });
        store.reset();
        scope.assert.deepEqual<unknown, unknown>(values.next(), { done: false, value: 42 });
        scope.assert.throws(function () {
            return values.throw?.(new Error('Old iterator.'));
        }, { message: 'Old iterator.' });
        scope.assert.deepEqual<unknown, unknown>(store.iteratorEvents, []);
        return scope.assert.collect();
    }),
    test('keeps old asynchronous iterators functional after recording resets', async function (scope) {
        const store = createHistoryStore(function () {
            return undefined;
        });
        const values = createAsyncTrackedIterator(store, invocation, function () {
            return {
                async next() {
                    return { done: false, value: 42 };
                }
            };
        });
        store.reset();
        scope.assert.deepEqual<unknown, unknown>(await values.next(), { done: false, value: 42 });
        await scope.assert.rejects(async function () {
            return values.throw?.(new Error('Old iterator.'));
        }, {
            message: 'Old iterator.'
        });
        scope.assert.deepEqual<unknown, unknown>(store.iteratorEvents, []);
        return scope.assert.collect();
    })
]);
