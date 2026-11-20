import {
    type TestNode,
    type TestScope,
    suite,
    test,
    testDouble as callbackDouble,
    doubleUsage
} from '@overkill-dev/test';

import type { BehaviorRuntime, Invocation } from './double-behavior.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type ReadValue = (path: string, callback: (error: Error | null, value: string) => void) => undefined;
type CallbackReceiver = {
    readonly scope: string;
};
type LoadScopedCallback = (path: string, callback: (this: CallbackReceiver, value: string) => void) => string;
const unusedBehaviorRuntime: BehaviorRuntime = {
    nextSequenceEntry() {
        throw new Error('unexpected sequence behavior.');
    },
    trackAsyncIterator() {
        throw new Error('unexpected async iterator tracking.');
    },
    trackSyncIterator() {
        throw new Error('unexpected sync iterator tracking.');
    }
};

export const testNode: TestNode = suite('Test double callback', [
    test('rule.callsCallback() invokes a callback argument synchronously', function (scope) {
        const seen: unknown[] = [];
        const readValue = testDouble<ReadValue>({
            fallback: rule.callsCallback(1, [ null, 'contents' ], undefined)
        });

        readValue('file.txt', function recordValue(error, value) {
            seen.push(error, value);
        });

        scope.assert.deepEqual(seen, [ null, 'contents' ]);

        return scope.assert.collect();
    }),
    test('rule.callsCallbackAsync() invokes a callback argument in a microtask', async function (scope) {
        const seen: string[] = [];
        const readValue = testDouble<ReadValue>({
            rules: [
                rule.when('file.txt').callsCallbackAsync(1, [ null, 'contents' ], undefined)
            ]
        });

        readValue('file.txt', function recordValue() {
            seen.push('callback');
        });
        seen.push('returned');

        scope.assert.deepEqual(Array.from(seen), [ 'returned' ]);
        await Promise.resolve();
        scope.assert.deepEqual(Array.from(seen), [ 'returned', 'callback' ]);

        return scope.assert.collect();
    }),
    test('callback rule factories expose their configured return values', function (scope) {
        scope.assert.equal(rule.callsCallback(0, [], 'sync').result(), 'sync');
        scope.assert.equal(rule.callsCallbackAsync(0, [], 'async').result(), 'async');

        return scope.assert.collect();
    }),
    test('rule.callsCallback() binds a callback receiver', function (scope: TestScope) {
        const receiver = { scope: 'test' };
        const callback = callbackDouble<(value: string) => undefined>();
        const loadScoped = testDouble<LoadScopedCallback>({
            rules: [
                rule.when('known').callsCallback(1, [ 'value' ], 'returned', receiver)
            ]
        });

        scope.assert.equal(loadScoped('known', callback), 'returned');
        const { firstCall } = callback;
        scope.require.notNull(firstCall);
        scope.assert.equal(firstCall.thisValue, receiver);
        scope.assert.deepEqual(firstCall.arguments, [ 'value' ]);

        return scope.assert.collect();
    }),
    test(
        'rule.callsCallbackAsync() supports argument rules and receiver binding',
        async function (scope: TestScope) {
            const receiver = { scope: 'async' };
            const callback = callbackDouble<(value: string) => undefined>();
            const loadScoped = testDouble<LoadScopedCallback>({
                rules: [
                    rule.when('known').callsCallbackAsync(1, [ 'value' ], 'returned', receiver)
                ]
            });

            scope.assert.equal(loadScoped('known', callback), 'returned');
            scope.assert(doubleUsage.callCount, callback, 0);
            await Promise.resolve();
            const { firstCall } = callback;
            scope.require.notNull(firstCall);
            scope.assert.deepEqual(
                {
                    arguments: firstCall.arguments,
                    thisValue: firstCall.thisValue
                },
                {
                    arguments: [ 'value' ],
                    thisValue: receiver
                }
            );

            return scope.assert.collect();
        }
    ),
    test('rule.callsCallback() supports argument rules and ordered rules', function (scope) {
        const seen: string[] = [];
        const readValue = testDouble<ReadValue>({
            rules: [
                rule.when('known').callsCallback(1, [ null, 'known value' ], undefined),
                rule.onCall(1).callsCallback(1, [ null, 'second call' ], undefined)
            ]
        });

        readValue('known', function recordKnown(error, value) {
            scope.assert.equal(error, null);
            seen.push(value);
        });
        readValue('other', function recordOther(error, value) {
            scope.assert.equal(error, null);
            seen.push(value);
        });

        scope.assert.deepEqual(seen, [ 'known value', 'second call' ]);

        return scope.assert.collect();
    }),
    test('rule.callsCallback() validates callback behavior at runtime', function (scope) {
        scope.assert.throws(function createNegativeCallbackRule() {
            rule.callsCallback(-1, [], undefined);
        }, { message: /non-negative integer/u });

        const readValue = testDouble<(callback: (value: string) => void) => undefined>({
            fallback: rule.callsCallback(0, [ 'value' ], undefined)
        });

        scope.assert.throws(function callWithoutCallback() {
            (readValue as unknown as (callback: unknown) => undefined)(null);
        }, { message: /requires argument 0 to be a function/u });

        return scope.assert.collect();
    }),
    test('rule.callsCallback() rejects construction invocations', function (scope) {
        const constructionInvocation: Invocation = {
            arguments: [],
            index: 0,
            kind: 'construction'
        };
        const callbackBehavior = rule.callsCallback(0, [], undefined);

        scope.assert.throws(function produceConstructionCallback() {
            callbackBehavior.produce(constructionInvocation, unusedBehaviorRuntime);
        }, { message: /can only answer calls/u });

        return scope.assert.collect();
    }),
    test('rule.callsCallback() snapshots callback arguments', function (scope) {
        const values: [string] = [ 'first' ];
        const seen: string[] = [];
        const loadValue = testDouble<(callback: (value: string) => void) => undefined>({
            fallback: rule.callsCallback(0, values, undefined)
        });

        values[0] = 'second';
        loadValue(function recordValue(value) {
            seen.push(value);
        });

        scope.assert.deepEqual(seen, [ 'first' ]);

        return scope.assert.collect();
    }),
    test('rule.sequence() supports callback behavior entries', async function (scope) {
        const seen: string[] = [];
        const readValue = testDouble<ReadValue>({
            fallback: rule.sequence([
                rule.callsCallback(1, [ null, 'sync' ], undefined),
                rule.callsCallbackAsync(1, [ null, 'async' ], undefined)
            ])
        });

        readValue('first', function recordSync(error, value) {
            scope.assert.equal(error, null);
            seen.push(value);
        });
        readValue('second', function recordAsync(error, value) {
            scope.assert.equal(error, null);
            seen.push(value);
        });

        scope.assert.deepEqual(Array.from(seen), [ 'sync' ]);
        await Promise.resolve();
        scope.assert.deepEqual(Array.from(seen), [ 'sync', 'async' ]);

        return scope.assert.collect();
    })
]);
