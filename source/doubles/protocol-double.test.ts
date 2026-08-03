import assert from 'node:assert/strict';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TestBody, TestScope } from '../engine/test-node.ts';
import { doubleUsage } from './double-usage.ts';
import { rule } from './double-rule.ts';
import {
    testAsyncDisposable,
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testIterable,
    testIterator
} from './protocol-double.ts';
import {
    protocolDisposeMethod,
    protocolIteratorEvents
} from './protocol-double-metadata.ts';

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createTestEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createSuite({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        name: 'case'
                    })
                ],
                metadata: {},
                name: 'root'
            })
        )
    );
}

registerTest('testIterator.yields() creates a well-formed consumable iterator', function () {
    const values = testIterator.yields([ 'a', 'b' ], 'done');

    assert.equal(values[Symbol.iterator](), values);
    assert.equal(typeof values.map, 'function');
    assert.deepEqual(Array.from(values), [ 'a', 'b' ]);
    assert.deepEqual(Array.from(values), []);
    assert.equal(values.next.callCount, 4);
});

registerTest('testIterator.yields() preserves tracked return values', function () {
    const values = testIterator.yields([ 'a', 'b' ], 'done');

    assert.deepEqual(values.return('early'), { done: true, value: 'early' });
    assert.equal(values.return.callCount, 1);
    assert.equal(values.next.callCount, 0);
});

registerTest('testIterable.yields() creates fresh well-formed iterators', function () {
    const source = testIterable.yields([ 'a', 'b' ]);

    assert.deepEqual(Array.from(source), [ 'a', 'b' ]);
    assert.deepEqual(Array.from(source), [ 'a', 'b' ]);
    assert.equal(source[Symbol.iterator].callCount, 2);
});

registerTest('testIterator() exposes programmable protocol methods', function () {
    const expected = new Error('expected');
    const values = testIterator<string, string>({
        next: { fallback: rule.returns({ done: false, value: 'configured' }) },
        return: { fallback: rule.returns({ done: true, value: 'returned' }) },
        throw: { fallback: rule.throws(expected) }
    });

    assert.deepEqual(values.next(), { done: false, value: 'configured' });
    assert.deepEqual(values.return(), { done: true, value: 'returned' });
    assert.throws(function throwIntoIterator() {
        values.throw(expected);
    }, expected);
    assert.equal(values.next.callCount, 1);
    assert.equal(values.return.callCount, 1);
    assert.equal(values.throw.callCount, 1);
});

registerTest('testIterator() creates default completed protocol methods', function () {
    const values = testIterator();

    assert.deepEqual(values.next(), { done: true, value: undefined });
    assert.deepEqual(values.return('early'), { done: true, value: 'early' });
    assert.throws(function throwIntoIterator() {
        values.throw('expected');
    }, /expected/u);
});

registerTest('testAsyncIterator.yields() creates an async iterable iterator', async function () {
    const values = testAsyncIterator.yields([ 'a', 'b' ], 'done');
    const seen: string[] = [];

    assert.equal(values[Symbol.asyncIterator](), values);

    for await (const value of values) {
        seen.push(value);
    }

    assert.deepEqual(seen, [ 'a', 'b' ]);
    assert.equal(values.next.callCount, 3);
});

registerTest('testAsyncIterator() creates default completed protocol methods', async function () {
    const values = testAsyncIterator();

    assert.deepEqual(await values.next(), { done: true, value: undefined });
    assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
    await assert.rejects(values.throw('expected'), /expected/u);
});

registerTest('testAsyncIterable.yields() creates fresh async iterators', async function () {
    const source = testAsyncIterable.yields([ 'a', 'b' ]);
    const first: string[] = [];
    const second: string[] = [];

    for await (const value of source) {
        first.push(value);
    }

    for await (const value of source) {
        second.push(value);
    }

    assert.deepEqual(first, [ 'a', 'b' ]);
    assert.deepEqual(second, [ 'a', 'b' ]);
    assert.equal(source[Symbol.asyncIterator].callCount, 2);
});

registerTest('testIterable() creates default fresh iterators', function () {
    const source = testIterable();

    assert.deepEqual(source[Symbol.iterator]().next(), { done: true, value: undefined });
    assert.deepEqual(source[Symbol.iterator]().next(), { done: true, value: undefined });
    assert.equal(source[Symbol.iterator].callCount, 2);
});

registerTest('testAsyncIterable() creates default fresh async iterators', async function () {
    const source = testAsyncIterable();

    assert.deepEqual(await source[Symbol.asyncIterator]().next(), { done: true, value: undefined });
    assert.deepEqual(await source[Symbol.asyncIterator]().next(), { done: true, value: undefined });
    assert.equal(source[Symbol.asyncIterator].callCount, 2);
});

registerTest('testIterable() exposes configured iterator factory', function () {
    const iterator = testIterator.yields([ 'configured' ]);
    const source = testIterable({
        iterator: { fallback: rule.returns(iterator) }
    });

    assert.deepEqual(Array.from(source), [ 'configured' ]);
    assert.equal(source[Symbol.iterator].callCount, 1);
});

registerTest('testAsyncIterable() exposes configured async iterator factory', async function () {
    const iterator = testAsyncIterator.yields([ 'configured' ]);
    const source = testAsyncIterable({
        asyncIterator: { fallback: rule.returns(iterator) }
    });
    const seen = await Array.fromAsync(source);

    assert.deepEqual(seen, [ 'configured' ]);
    assert.equal(source[Symbol.asyncIterator].callCount, 1);
});

registerTest('testIterable.yieldsFrom() creates fresh delegated iterators', function () {
    const source = testIterable.yieldsFrom(function values() {
        return [ 'a' ][Symbol.iterator]();
    });

    assert.deepEqual(Array.from(source), [ 'a' ]);
    assert.deepEqual(Array.from(source), [ 'a' ]);
});

registerTest('testAsyncIterable.yieldsFrom() creates fresh delegated async iterators', async function () {
    const source = testAsyncIterable.yieldsFrom(async function* values() {
        yield 'a';
    });
    const seen = await Array.fromAsync(source);

    assert.deepEqual(seen, [ 'a' ]);
});

registerTest('testDisposable() records using disposal', function () {
    const resource = testDisposable();

    {
        using value = resource;

        assert.equal(value, resource);
    }

    assert.equal(resource.dispose.callCount, 1);
});

registerTest('testAsyncDisposable() records await using disposal', async function () {
    const resource = testAsyncDisposable();

    {
        await using value = resource;

        assert.equal(value, resource);
    }

    assert.equal(resource.asyncDispose.callCount, 1);
});

registerTest('testDisposable() exposes programmable disposal', function () {
    const expected = new Error('expected');
    const resource = testDisposable({
        dispose: { fallback: rule.throws(expected) }
    });

    assert.throws(function disposeResource() {
        resource.dispose();
    }, expected);
    assert.equal(resource.dispose.callCount, 1);
});

registerTest('testAsyncDisposable() exposes programmable async disposal', async function () {
    const expected = new Error('expected');
    const resource = testAsyncDisposable({
        asyncDispose: { fallback: rule.rejects(expected) }
    });

    await assert.rejects(resource.asyncDispose(), expected);
    assert.equal(resource.asyncDispose.callCount, 1);
});

registerTest('testIterator.yieldsFrom() delegates return and throw fallbacks', function () {
    const values = testIterator.yieldsFrom(function source() {
        return [ 'a', 'b' ][Symbol.iterator]();
    });

    assert.deepEqual(values.next(), { done: false, value: 'a' });
    assert.deepEqual(values.return('early'), { done: true, value: 'early' });
    assert.throws(function throwIntoIterator() {
        values.throw('expected');
    }, /expected/u);
});

registerTest('testIterator.yieldsFrom() delegates generator return and throw methods', function () {
    const expected = new Error('expected');
    const values = testIterator.yieldsFrom(function* source() {
        yield 'a';
        return 'done';
    });

    assert.deepEqual(values.next(), { done: false, value: 'a' });
    assert.deepEqual(values.return('early'), { done: true, value: 'early' });
    assert.throws(function throwIntoIterator() {
        values.throw(expected);
    }, expected);
});

registerTest('testAsyncIterator.yieldsFrom() delegates sync sources', async function () {
    const values = testAsyncIterator.yieldsFrom(function source() {
        return [ 'a' ][Symbol.iterator]();
    });

    assert.deepEqual(await values.next(), { done: false, value: 'a' });
    assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
    await assert.rejects(values.throw('expected'), /expected/u);
});

registerTest('testAsyncIterator.yieldsFrom() delegates async return fallback', async function () {
    const values = testAsyncIterator.yieldsFrom(function source() {
        return {
            async next() {
                return { done: false, value: 'a' };
            }
        };
    });

    assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
});

registerTest('testAsyncIterator.yieldsFrom() delegates async generator return and throw methods', async function () {
    const expected = new Error('expected');
    const values = testAsyncIterator.yieldsFrom(async function* source() {
        yield 'a';
        return 'done';
    });

    assert.deepEqual(await values.next(), { done: false, value: 'a' });
    assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
    await assert.rejects(values.throw(expected), expected);
});

registerTest('testAsyncIterator() tracks rejected protocol methods', async function () {
    const expected = new Error('expected');
    const values = testAsyncIterator({
        next: { fallback: rule.rejects(expected) },
        return: { fallback: rule.resolves({ done: true, value: undefined }) },
        throw: { fallback: rule.rejects(expected) }
    });

    await assert.rejects(values.next(), expected);
    await assert.rejects(values.throw(expected), expected);
});

registerTest('protocol metadata rejects non-protocol values', function () {
    assert.equal(protocolDisposeMethod({}), null);
    assert.equal(protocolIteratorEvents({}), null);
});

registerTest('protocol metadata reports null disposal for iterator protocols', function () {
    assert.equal(protocolDisposeMethod(testAsyncIterator()), null);
    assert.equal(protocolDisposeMethod(testIterable()), null);
    assert.equal(protocolDisposeMethod(testAsyncIterable()), null);
});

registerTest('protocol iterable metadata ignores thrown iterator factory calls', function () {
    const source = testIterable({
        iterator: { fallback: rule.throws(new Error('expected')) }
    });

    assert.throws(function createIterator() {
        source[Symbol.iterator]();
    }, /expected/u);
    assert.deepEqual(protocolIteratorEvents(source), []);
});

registerTest('protocol iterator assertions accept protocol objects', async function () {
    const source = testIterable.yields([ 'created', 'updated' ]);
    const result = await executeSingleBody(function body(testScope: TestScope) {
        assert.deepEqual(Array.from(source), [ 'created', 'updated' ]);

        testScope.assert(doubleUsage.iterated, source);
        testScope.assert(doubleUsage.iteratorEventCount, source, 3);
        testScope.assert(doubleUsage.yieldCount, source, 2);
        testScope.assert(doubleUsage.yieldedExactly, source, [ 'created', 'updated' ]);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

function assertDisposalUsage(testScope: TestScope, first: unknown, second: unknown): void {
    testScope.assert(doubleUsage.disposed, first);
    testScope.assert(doubleUsage.disposedOnce, first);
    testScope.assert(doubleUsage.disposeCount, first, 1);
    testScope.assert(doubleUsage.disposeOrder, [ second, first ]);
    testScope.assert(doubleUsage.notDisposed, testDisposable());
}

registerTest('disposal assertions accept disposable protocol objects', async function () {
    const first = testDisposable();
    const second = testDisposable();
    const result = await executeSingleBody(function body(testScope: TestScope) {
        {
            using firstResource = first;
            using secondResource = second;

            assert.equal(firstResource, first);
            assert.equal(secondResource, second);
        }

        assertDisposalUsage(testScope, first, second);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('disposal assertions reject invalid protocol inputs', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.disposed, {});
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});

registerTest('disposal assertions validate counts and order inputs', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.disposeCount, testDisposable(), -1);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});

registerTest('disposal order rejects invalid protocol entries', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.disposeOrder, [ {}, testDisposable() ]);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});

registerTest('disposal order reports missing disposal events', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.disposeOrder, [ testDisposable(), testDisposable() ]);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});

registerTest('disposal order rejects too few runtime entries', async function () {
    const disposables: [unknown, unknown] = [ testDisposable(), testDisposable() ];
    disposables.pop();
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.disposeOrder, disposables);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});

registerTest('iterator assertions reject invalid protocol inputs', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.iterated, {});
        testScope.assert(doubleUsage.notIterated, {});
        testScope.assert(doubleUsage.iteratorEventCount, {}, 1);
        testScope.assert(doubleUsage.yieldedExactly, {}, []);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});

registerTest('iterator assertions validate expected event counts', async function () {
    const result = await executeSingleBody(function body(testScope: TestScope) {
        testScope.assert(doubleUsage.iteratorEventCount, testIterable.yields([]), -1);
        return testScope.assert.collect();
    });

    assert.equal(result.summary.failed, 1);
});
