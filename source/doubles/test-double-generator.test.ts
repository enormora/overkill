import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type LoadNumbers = (prefix: string) => Generator<string, string, number>;
type LoadAsyncNumbers = (prefix: string) => AsyncGenerator<string, string, number>;

registerTest('testDouble.yields() returns fresh tracked iterators', function () {
    const loadNumbers = testDouble.yields<LoadNumbers>([ 'a', 'b' ], 'done');
    const first = loadNumbers('first');
    const second = loadNumbers('second');

    assert.deepEqual(first.next(1), { done: false, value: 'a' });
    assert.deepEqual(first.next(2), { done: false, value: 'b' });
    assert.deepEqual(first.next(3), { done: true, value: 'done' });
    assert.deepEqual(second.next(4), { done: false, value: 'a' });
    assert.equal(loadNumbers.callCount, 2);
    assert.equal(loadNumbers.iteratorEventCount, 4);
    assert.deepEqual(
        loadNumbers.iteratorEvents.map(function eventSummary(event) {
            return {
                arguments: event.arguments,
                callIndex: event.callIndex,
                kind: event.kind,
                method: event.method,
                value: event.kind === 'throw' ? null : event.value
            };
        }),
        [
            { arguments: [ 1 ], callIndex: 0, kind: 'yield', method: 'next', value: 'a' },
            { arguments: [ 2 ], callIndex: 0, kind: 'yield', method: 'next', value: 'b' },
            { arguments: [ 3 ], callIndex: 0, kind: 'return', method: 'next', value: 'done' },
            { arguments: [ 4 ], callIndex: 1, kind: 'yield', method: 'next', value: 'a' }
        ]
    );
});

registerTest('rule.yieldsFrom() delegates lazily with invocation arguments', function () {
    type LoadValues = (prefix: string) => Generator<string, string, unknown>;

    const seen: string[] = [];
    const loadValues = testDouble<LoadValues>({
        fallback: rule.yieldsFrom<LoadValues>(function* loadSource(prefix) {
            seen.push(prefix);
            yield `${prefix}:a`;
            yield `${prefix}:b`;
            return `${prefix}:done`;
        })
    });
    const values = loadValues('item');

    assert.deepEqual(seen, []);
    assert.deepEqual(values.next(), { done: false, value: 'item:a' });
    assert.deepEqual(values.next(), { done: false, value: 'item:b' });
    assert.deepEqual(values.next(), { done: true, value: 'item:done' });
    assert.deepEqual(seen, [ 'item' ]);
});

registerTest('tracked iterators record return protocol events', function () {
    const returned = testDouble.yields<() => Generator<string, string, unknown>>([ 'a', 'b' ], 'done');

    assert.deepEqual(returned().return('early'), { done: true, value: 'early' });
    assert.deepEqual(
        returned.iteratorEvents.map(function eventKind(event) {
            return event.kind;
        }),
        [ 'return' ]
    );
});

registerTest('tracked iterators record throw protocol events', function () {
    const expected = new Error('expected');
    const thrown = testDouble.yieldsFrom(function* values() {
        yield 'a';
    });

    assert.throws(function throwIntoIterator() {
        thrown().throw(expected);
    }, expected);
    const thrownEvent = thrown.firstIteratorEvent;

    if (thrownEvent === null) {
        throw new Error('Expected iterator event.');
    }

    assert.equal(thrownEvent.kind, 'throw');
    assert.equal(thrownEvent.method, 'throw');
});

registerTest('tracked iterators record calls after completion', function () {
    const loadValue = testDouble.yields([ 'a' ]);
    const values = loadValue();

    assert.deepEqual(values.next(), { done: false, value: 'a' });
    assert.deepEqual(values.next(), { done: true, value: undefined });
    assert.deepEqual(values.next(), { done: true, value: undefined });
    assert.equal(loadValue.iteratorEventCount, 3);
    assert.deepEqual(
        loadValue.iteratorEvents.map(function eventKind(event) {
            return event.kind;
        }),
        [ 'yield', 'return', 'return' ]
    );
});

registerTest('reset detaches existing tracked iterators from history', function () {
    const loadValue = testDouble.yields([ 'a', 'b' ]);
    const values = loadValue();

    assert.deepEqual(values.next(), { done: false, value: 'a' });
    loadValue.reset();
    assert.deepEqual(values.next(), { done: false, value: 'b' });
    assert.equal(loadValue.iteratorEventCount, 0);
    assert.deepEqual(loadValue().next(), { done: false, value: 'a' });
    assert.equal(loadValue.iteratorEventCount, 1);
});

registerTest('testDouble.yieldsAsync() records async iterator events after settlement', async function () {
    const loadValues = testDouble.yieldsAsync<LoadAsyncNumbers>([ 'a', 'b' ], 'done');
    const values = loadValues('scope');
    const pending = values.next(1);

    assert.equal(loadValues.iteratorEventCount, 0);
    assert.deepEqual(await pending, { done: false, value: 'a' });
    assert.equal(loadValues.iteratorEventCount, 1);
    assert.deepEqual(await values.next(2), { done: false, value: 'b' });
    assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
    assert.deepEqual(
        loadValues.iteratorEvents.map(function eventSummary(event) {
            return {
                arguments: event.arguments,
                kind: event.kind,
                method: event.method,
                protocol: event.protocol
            };
        }),
        [
            { arguments: [ 1 ], kind: 'yield', method: 'next', protocol: 'async' },
            { arguments: [ 2 ], kind: 'yield', method: 'next', protocol: 'async' },
            { arguments: [ 'early' ], kind: 'return', method: 'return', protocol: 'async' }
        ]
    );
});

registerTest('rule.yieldsAsyncFrom() delegates to sync and async sources', async function () {
    type LoadValues = (scope: string) => AsyncGenerator<string, string, unknown>;

    const loadSyncValues = testDouble<LoadValues>({
        fallback: rule.yieldsAsyncFrom<LoadValues>(function* loadSource(scope) {
            yield `${scope}:sync`;
            return `${scope}:done`;
        })
    });
    const loadAsyncValues = testDouble<LoadValues>({
        fallback: rule.yieldsAsyncFrom<LoadValues>(async function* loadSource(scope) {
            yield `${scope}:async`;
            return `${scope}:done`;
        })
    });

    assert.deepEqual(await loadSyncValues('a').next(), { done: false, value: 'a:sync' });
    assert.deepEqual(await loadAsyncValues('b').next(), { done: false, value: 'b:async' });
});
