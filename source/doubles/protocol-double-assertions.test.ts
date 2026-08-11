import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { TestBody, TestScope } from '../engine/test-node.ts';
import { doubleUsage } from './double-usage.ts';
import { rule } from './double-rule.ts';
import {
    testAsyncIterable,
    testAsyncIterator,
    testDisposable,
    testIterable
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

export const testSuite = createOverkillSuite({
    name: 'source/doubles/protocol-double-assertions.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'testAsyncIterator() tracks rejected protocol methods',
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
            name: 'protocol metadata rejects non-protocol values',
            metadata: {},
            body: function body(scope: OverkillScope) {
                scope.assert.equal(protocolDisposeMethod({}), null);
                scope.assert.equal(protocolIteratorEvents({}), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'protocol metadata reports null disposal for iterator protocols',
            metadata: {},
            body: function body(scope: OverkillScope) {
                scope.assert.equal(protocolDisposeMethod(testAsyncIterator()), null);
                scope.assert.equal(protocolDisposeMethod(testIterable()), null);
                scope.assert.equal(protocolDisposeMethod(testAsyncIterable()), null);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'protocol iterable metadata ignores thrown iterator factory calls',
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
            name: 'protocol iterator assertions accept protocol objects',
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
            name: 'disposal assertions accept disposable protocol objects',
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
            name: 'disposal assertions reject invalid protocol inputs',
            metadata: {},
            body: async function body(scope: OverkillScope) {
                const result = await executeSingleBody(function testBody(testScope: TestScope) {
                    testScope.assert(doubleUsage.disposed, {});
                    return testScope.assert.collect();
                });

                scope.assert.equal(result.summary.failed, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'disposal assertions validate counts and order inputs',
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
            name: 'disposal order rejects invalid protocol entries',
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
            name: 'disposal order reports missing disposal events',
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
            name: 'disposal order rejects too few runtime entries',
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
            name: 'iterator assertions reject invalid protocol inputs',
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
            name: 'iterator assertions validate expected event counts',
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
