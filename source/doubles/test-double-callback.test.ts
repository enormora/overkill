import assert from 'node:assert/strict';
import sinon from 'sinon';
import { registerTest } from '../test-support/register-test.ts';
import type { BehaviorRuntime, Invocation } from './double-behavior.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type ReadValue = (path: string, callback: (error: Error | null, value: string) => void) => undefined;
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

registerTest('rule.callsCallback() invokes a callback argument synchronously', function () {
    const seen: unknown[] = [];
    const readValue = testDouble<ReadValue>({
        fallback: rule.callsCallback(1, [ null, 'contents' ], undefined)
    });

    readValue('file.txt', function recordValue(error, value) {
        seen.push(error, value);
    });

    assert.deepEqual(seen, [ null, 'contents' ]);
});

registerTest('rule.callsCallbackAsync() invokes a callback argument in a microtask', async function () {
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

    assert.deepEqual(seen, [ 'returned' ]);
    await Promise.resolve();
    assert.deepEqual(seen, [ 'returned', 'callback' ]);
});

registerTest('callback rule factories expose their configured return values', function () {
    assert.equal(rule.callsCallback(0, [], 'sync').result(), 'sync');
    assert.equal(rule.callsCallbackAsync(0, [], 'async').result(), 'async');
});

registerTest('rule.callsCallback() binds a callback receiver', function () {
    type Receiver = {
        readonly scope: string;
    };
    type LoadScoped = (path: string, callback: (this: Receiver, value: string) => void) => string;

    const receiver = { scope: 'test' };
    const callback = sinon.fake<[string], undefined>();
    const loadScoped = testDouble<LoadScoped>({
        rules: [
            rule.when('known').callsCallback(1, [ 'value' ], 'returned', receiver)
        ]
    });

    assert.equal(loadScoped('known', callback), 'returned');
    assert.equal(callback.firstCall.thisValue, receiver);
    assert.deepEqual(callback.firstCall.args, [ 'value' ]);
});

registerTest('rule.callsCallbackAsync() supports argument rules and receiver binding', async function () {
    type Receiver = {
        readonly scope: string;
    };
    type LoadScoped = (path: string, callback: (this: Receiver, value: string) => void) => string;

    const receiver = { scope: 'async' };
    const callback = sinon.fake<[string], undefined>();
    const loadScoped = testDouble<LoadScoped>({
        rules: [
            rule.when('known').callsCallbackAsync(1, [ 'value' ], 'returned', receiver)
        ]
    });

    assert.equal(loadScoped('known', callback), 'returned');
    assert.equal(callback.called, false);
    await Promise.resolve();
    assert.equal(callback.firstCall.thisValue, receiver);
    assert.deepEqual(callback.firstCall.args, [ 'value' ]);
});

registerTest('rule.callsCallback() supports argument rules and ordered rules', function () {
    const seen: string[] = [];
    const readValue = testDouble<ReadValue>({
        rules: [
            rule.when('known').callsCallback(1, [ null, 'known value' ], undefined),
            rule.onCall(1).callsCallback(1, [ null, 'second call' ], undefined)
        ]
    });

    readValue('known', function recordKnown(error, value) {
        assert.equal(error, null);
        seen.push(value);
    });
    readValue('other', function recordOther(error, value) {
        assert.equal(error, null);
        seen.push(value);
    });

    assert.deepEqual(seen, [ 'known value', 'second call' ]);
});

registerTest('rule.callsCallback() validates callback behavior at runtime', function () {
    assert.throws(function createNegativeCallbackRule() {
        rule.callsCallback(-1, [], undefined);
    }, /non-negative integer/u);

    const readValue = testDouble<(callback: (value: string) => void) => undefined>({
        fallback: rule.callsCallback(0, [ 'value' ], undefined)
    });

    assert.throws(function callWithoutCallback() {
        (readValue as unknown as (callback: unknown) => undefined)(null);
    }, /requires argument 0 to be a function/u);
});

registerTest('rule.callsCallback() rejects construction invocations', function () {
    const constructionInvocation: Invocation = {
        arguments: [],
        index: 0,
        kind: 'construction'
    };
    const callbackBehavior = rule.callsCallback(0, [], undefined);

    assert.throws(function produceConstructionCallback() {
        callbackBehavior.produce(constructionInvocation, unusedBehaviorRuntime);
    }, /can only answer calls/u);
});

registerTest('rule.callsCallback() snapshots callback arguments', function () {
    const values: [string] = [ 'first' ];
    const seen: string[] = [];
    const loadValue = testDouble<(callback: (value: string) => void) => undefined>({
        fallback: rule.callsCallback(0, values, undefined)
    });

    values[0] = 'second';
    loadValue(function recordValue(value) {
        seen.push(value);
    });

    assert.deepEqual(seen, [ 'first' ]);
});

registerTest('rule.sequence() supports callback behavior entries', async function () {
    const seen: string[] = [];
    const readValue = testDouble<ReadValue>({
        fallback: rule.sequence([
            rule.callsCallback(1, [ null, 'sync' ], undefined),
            rule.callsCallbackAsync(1, [ null, 'async' ], undefined)
        ])
    });

    readValue('first', function recordSync(error, value) {
        assert.equal(error, null);
        seen.push(value);
    });
    readValue('second', function recordAsync(error, value) {
        assert.equal(error, null);
        seen.push(value);
    });

    assert.deepEqual(seen, [ 'sync' ]);
    await Promise.resolve();
    assert.deepEqual(seen, [ 'sync', 'async' ]);
});
