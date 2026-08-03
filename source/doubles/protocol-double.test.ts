import assert from 'node:assert/strict';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { registerTest } from '../test-support/register-test.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TestBody, TestContext } from '../engine/test-node.ts';
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

registerTest('testDisposable() records using disposal', function () {
    const resource = testDisposable();

    {
        using value = resource;

        assert.equal(value, resource);
    }

    assert.equal(resource[Symbol.dispose].callCount, 1);
});

registerTest('testAsyncDisposable() records await using disposal', async function () {
    const resource = testAsyncDisposable();

    {
        await using value = resource;

        assert.equal(value, resource);
    }

    assert.equal(resource[Symbol.asyncDispose].callCount, 1);
});

registerTest('protocol iterator assertions accept protocol objects', async function () {
    const source = testIterable.yields([ 'created', 'updated' ]);
    const result = await executeSingleBody(function body(testContext: TestContext) {
        assert.deepEqual(Array.from(source), [ 'created', 'updated' ]);

        testContext.assert(doubleUsage.iterated, source);
        testContext.assert(doubleUsage.iteratorEventCount, source, 3);
        testContext.assert(doubleUsage.yieldCount, source, 2);
        testContext.assert(doubleUsage.yieldedExactly, source, [ 'created', 'updated' ]);
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});

registerTest('disposal assertions accept disposable protocol objects', async function () {
    const first = testDisposable();
    const second = testDisposable();
    const result = await executeSingleBody(function body(testContext: TestContext) {
        {
            using firstResource = first;
            using secondResource = second;

            assert.equal(firstResource, first);
            assert.equal(secondResource, second);
        }

        testContext.assert(doubleUsage.disposed, first);
        testContext.assert(doubleUsage.disposedOnce, first);
        testContext.assert(doubleUsage.disposeCount, first, 1);
        testContext.assert(doubleUsage.disposeOrder, [ second, first ]);
        testContext.assert(doubleUsage.notDisposed, testDisposable());
        return testContext.assert.done();
    });

    assert.equal(result.summary.passed, 1);
    assert.equal(result.summary.failed, 0);
});
