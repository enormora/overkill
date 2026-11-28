import { type TestScope, suite, test } from '@overkill-dev/test';
import { type EngineCaseBody, createTestEngine } from '../test-support/create-test-engine.ts';

import type { RunResult } from '../engine/run-result.ts';

import { doubleUsage } from './double-usage.ts';
import { rule } from './double-rule.ts';
import { createTestDoubleScope } from './test-double.ts';
import { testAsyncIterable, testAsyncIterator, testDisposable, testIterable } from './protocol-double.ts';
import { installProtocolMetadata, protocolDisposeMethod, protocolIteratorEvents } from './protocol-double-metadata.ts';

async function executeSingleBody(body: EngineCaseBody): Promise<RunResult> {
    const engine = createTestEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        definitionLocations: [ { kind: 'unknown' as const } ],
                        body,
                        annotations: {},
                        controls: {},
                        title: 'case'
                    })
                ],
                annotations: {},
                controls: {},
                title: 'root'
            })
        )
    );
}

type MetadataDisposable = {
    readonly dispose: () => void;
};

function metadataDisposable(dispose: () => void): MetadataDisposable {
    const disposable = { dispose };

    installProtocolMetadata(disposable, {
        disposeMethod() {
            return dispose;
        },
        iteratorEvents() {
            return [];
        },
        kind: 'disposable'
    });

    return disposable;
}

export const testNode = suite('Protocol double assertions', [
    test('testAsyncIterator() tracks rejected protocol methods', async function body(scope) {
        const expected = new Error('expected');
        const values = testAsyncIterator({
            next: { fallback: rule.rejects(expected) },
            return: { fallback: rule.resolves({ done: true, value: undefined }) },
            throw: { fallback: rule.rejects(expected) }
        });

        await scope.assert.rejects(async function rejectValue() {
            await values.next();
        }, { exact: expected });
        await scope.assert.rejects(async function rejectValue() {
            await values.throw(expected);
        }, { exact: expected });

        return scope.assert.collect();
    }),
    test('protocol metadata rejects non-protocol values', function body(scope) {
        scope.assert.equal(protocolDisposeMethod({}), null);
        scope.assert.equal(protocolIteratorEvents({}), null);

        return scope.assert.collect();
    }),
    test('protocol metadata reports null disposal for iterator protocols', function body(scope) {
        scope.assert.equal(protocolDisposeMethod(testAsyncIterator()), null);
        scope.assert.equal(protocolDisposeMethod(testIterable()), null);
        scope.assert.equal(protocolDisposeMethod(testAsyncIterable()), null);

        return scope.assert.collect();
    }),
    test('protocol iterable metadata ignores thrown iterator factory calls', function body(scope: TestScope) {
        const source = testIterable({
            iterator: { fallback: rule.throws(new Error('expected')) }
        });

        scope.assert.throws(function createIterator() {
            source[Symbol.iterator]();
        }, { message: /expected/u });
        const events = protocolIteratorEvents(source);

        scope.require.notNull(events);
        scope.assert.deepEqual(events, []);

        return scope.assert.collect();
    }),
    test('protocol iterator assertions accept protocol objects', async function body(scope) {
        const source = testIterable.yields([ 'created', 'updated' ]);
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert.deepEqual(Array.from(source), [ 'created', 'updated' ]);

            testScope.assert(doubleUsage.iterated, source);
            testScope.assert(doubleUsage.iteratorEventCount, source, 3);
            testScope.assert(doubleUsage.yieldCount, source, 2);
            testScope.assert(doubleUsage.yieldedExactly, source, [ 'created', 'updated' ]);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 0);

        return scope.assert.collect();
    }),
    test('disposal assertions accept disposable protocol objects', async function body(scope) {
        const first = testDisposable();
        const second = testDisposable();
        const result = await executeSingleBody(function testBody(testScope) {
            {
                using firstResource = first;
                using secondResource = second;

                testScope.assert.deepEqual([ firstResource, secondResource ], [ first, second ]);
            }

            testScope.assert(doubleUsage.disposed, first);
            testScope.assert(doubleUsage.disposeCount, first, 1);
            testScope.assert(doubleUsage.disposedOnce, first);
            testScope.assert(doubleUsage.disposeOrder, [ second, first ]);
            testScope.assert(doubleUsage.notDisposed, testDisposable());
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.passed, 1);
        scope.assert.equal(result.summary.failed, 0);

        return scope.assert.collect();
    }),
    test('disposal assertions reject invalid protocol inputs', async function body(scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.disposed, {});
            testScope.assert(doubleUsage.notDisposed, {});
            testScope.assert(doubleUsage.disposedOnce, {});
            testScope.assert(doubleUsage.disposeCount, {}, 0);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test(
        'disposal assertions reject protocol inputs without double methods',
        async function body(scope) {
            const disposable = metadataDisposable(function dispose() {
                return undefined;
            });
            const result = await executeSingleBody(function testBody(testScope) {
                testScope.assert(doubleUsage.disposed, disposable);
                return testScope.assert.collect();
            });

            scope.assert.equal(result.summary.failed, 1);

            return scope.assert.collect();
        }
    ),
    test('disposal order rejects mixed double scopes', async function body(scope) {
        const firstScope = createTestDoubleScope();
        const secondScope = createTestDoubleScope();
        const first = metadataDisposable(firstScope.testDouble.returns<() => void>());
        const second = metadataDisposable(secondScope.testDouble.returns<() => void>());
        const result = await executeSingleBody(function testBody(testScope) {
            first.dispose();
            second.dispose();

            testScope.assert(doubleUsage.disposeOrder, [ first, second ]);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test('disposal assertions validate counts and order inputs', async function body(scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.disposeCount, testDisposable(), -1);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test('disposal order rejects invalid protocol entries', async function body(scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.disposeOrder, [ {}, testDisposable() ]);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test('disposal order reports missing disposal events', async function body(scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.disposeOrder, [ testDisposable(), testDisposable() ]);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test('disposal order rejects too few runtime entries', async function body(scope) {
        const disposables: [unknown, unknown] = [ testDisposable(), testDisposable() ];
        disposables.pop();
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.disposeOrder, disposables);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test('iterator assertions reject invalid protocol inputs', async function body(scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.iterated, {});
            testScope.assert(doubleUsage.notIterated, {});
            testScope.assert(doubleUsage.iteratorEventCount, {}, 1);
            testScope.assert(doubleUsage.yieldedExactly, {}, []);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    }),
    test('iterator assertions validate expected event counts', async function body(scope) {
        const result = await executeSingleBody(function testBody(testScope) {
            testScope.assert(doubleUsage.iteratorEventCount, testIterable.yields([]), -1);
            return testScope.assert.collect();
        });

        scope.assert.equal(result.summary.failed, 1);

        return scope.assert.collect();
    })
]);
