import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TestBody, TestScope } from '../engine/test-node.ts';
import { doubleUsage } from './double-usage.ts';
import { rule } from './double-rule.ts';
import { createTestDoubleScope } from './test-double.ts';
import {
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testIterable
} from './protocol-double.ts';
import {
    installProtocolMetadata,
    protocolDisposeMethod,
    protocolIteratorEvents
} from './protocol-double-metadata.ts';

async function executeSingleBody(body: TestBody): Promise<RunResult> {
    const engine = createTestEngine();

    return await engine.execute(
        engine.createTestPlan(
            engine.createRoot({
                children: [
                    engine.createTestCase({
                        body,
                        metadata: {},
                        title: 'case'
                    })
                ],
                metadata: {},
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

export const testSuite = createOverkillSuite({
    title: 'source/doubles/protocol-double-assertions.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'testAsyncIterator() tracks rejected protocol methods',
            metadata: {},
            body: async function body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            title: 'protocol metadata rejects non-protocol values',
            metadata: {},
            body: function body(scope: OverkillScope) {
                scope.assert.equal(protocolDisposeMethod({}), null);
                scope.assert.equal(protocolIteratorEvents({}), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'protocol metadata reports null disposal for iterator protocols',
            metadata: {},
            body: function body(scope: OverkillScope) {
                scope.assert.equal(protocolDisposeMethod(testAsyncIterator()), null);
                scope.assert.equal(protocolDisposeMethod(testIterable()), null);
                scope.assert.equal(protocolDisposeMethod(testAsyncIterable()), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'protocol iterable metadata ignores thrown iterator factory calls',
            metadata: {},
            body: function body(scope: OverkillScope) {
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
            }
        }),
        createOverkillTestCase({
            title: 'protocol iterator assertions accept protocol objects',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const source = testIterable.yields([ 'created', 'updated' ]);
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    scope.assert.deepEqual(Array.from(source), [ 'created', 'updated' ]);

                    testScope.assert(doubleUsage.iterated, source);
                    testScope.assert(doubleUsage.iteratorEventCount, source, 3);
                    testScope.assert(doubleUsage.yieldCount, source, 2);
                    testScope.assert(doubleUsage.yieldedExactly, source, [ 'created', 'updated' ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.passed, 1);
                scope.assert.equal(result.summary.failed, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal assertions accept disposable protocol objects',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const first = testDisposable();
                const second = testDisposable();
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    {
                        using firstResource = first;
                        using secondResource = second;

                        scope.assert.deepEqual([ firstResource, secondResource ], [ first, second ]);
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
            }
        }),
        createOverkillTestCase({
            title: 'disposal assertions reject invalid protocol inputs',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposed, {});
                    testScope.assert(doubleUsage.notDisposed, {});
                    testScope.assert(doubleUsage.disposedOnce, {});
                    testScope.assert(doubleUsage.disposeCount, {}, 0);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal assertions reject protocol inputs without double methods',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const disposable = metadataDisposable(function dispose() {
                    return undefined;
                });
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposed, disposable);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal order rejects mixed double scopes',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const firstScope = createTestDoubleScope();
                const secondScope = createTestDoubleScope();
                const first = metadataDisposable(firstScope.testDouble.returns<() => void>());
                const second = metadataDisposable(secondScope.testDouble.returns<() => void>());
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    first.dispose();
                    second.dispose();

                    testScope.assert(doubleUsage.disposeOrder, [ first, second ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal assertions validate counts and order inputs',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposeCount, testDisposable(), -1);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal order rejects invalid protocol entries',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposeOrder, [ {}, testDisposable() ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal order reports missing disposal events',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposeOrder, [ testDisposable(), testDisposable() ]);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'disposal order rejects too few runtime entries',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const disposables: [unknown, unknown] = [ testDisposable(), testDisposable() ];
                disposables.pop();
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposeOrder, disposables);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'iterator assertions reject invalid protocol inputs',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.iterated, {});
                    testScope.assert(doubleUsage.notIterated, {});
                    testScope.assert(doubleUsage.iteratorEventCount, {}, 1);
                    testScope.assert(doubleUsage.yieldedExactly, {}, []);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'iterator assertions validate expected event counts',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.iteratorEventCount, testIterable.yields([]), -1);
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
