import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { rule } from './double-rule.ts';
import { testDouble } from './test-double.ts';

type LoadNumbers = (prefix: string) => Generator<string, string, number>;
type LoadAsyncNumbers = (prefix: string) => AsyncGenerator<string, string, number>;

export const testSuite = createOverkillSuite({
    title: 'source/doubles/test-double-generator.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'testDouble.yields() returns fresh tracked iterators',
            metadata: {},
            body(scope: OverkillScope) {
                const loadNumbers = testDouble.yields<LoadNumbers>([ 'a', 'b' ], 'done');
                const first = loadNumbers('first');
                const second = loadNumbers('second');

                scope.assert.deepEqual(
                    {
                        callCount: loadNumbers.callCount,
                        results: [ first.next(1), first.next(2), first.next(3), second.next(4) ],
                        eventCount: loadNumbers.iteratorEventCount
                    },
                    {
                        callCount: 2,
                        results: [
                            { done: false, value: 'a' },
                            { done: false, value: 'b' },
                            { done: true, value: 'done' },
                            { done: false, value: 'a' }
                        ],
                        eventCount: 4
                    }
                );
                scope.assert.deepEqual(
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'rule.yieldsFrom() delegates lazily with invocation arguments',
            metadata: {},
            body(scope: OverkillScope) {
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

                scope.assert.deepEqual(Array.from(seen), []);
                scope.assert.deepEqual(values.next(), { done: false, value: 'item:a' });
                scope.assert.deepEqual(values.next(), { done: false, value: 'item:b' });
                scope.assert.deepEqual(values.next(), { done: true, value: 'item:done' });
                scope.assert.deepEqual(Array.from(seen), [ 'item' ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'tracked iterators record return protocol events',
            metadata: {},
            body(scope: OverkillScope) {
                const returned = testDouble.yields<() => Generator<string, string, unknown>>([ 'a', 'b' ], 'done');

                scope.assert.deepEqual(returned().return('early'), { done: true, value: 'early' });
                scope.assert.deepEqual(
                    returned.iteratorEvents.map(function eventKind(event) {
                        return event.kind;
                    }),
                    [ 'return' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'tracked iterators record throw protocol events',
            metadata: {},
            body(scope: OverkillScope) {
                const expected = new Error('expected');
                const thrown = testDouble.yieldsFrom(function* values() {
                    yield 'a';
                });

                scope.assert.throws(function throwIntoIterator() {
                    thrown().throw(expected);
                }, { exact: expected });
                const thrownEvent = thrown.firstIteratorEvent;

                if (thrownEvent === null) {
                    throw new Error('Expected iterator event.');
                }

                scope.assert.equal(thrownEvent.kind, 'throw');
                scope.assert.equal(thrownEvent.method, 'throw');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'tracked iterators record calls after completion',
            metadata: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.yields([ 'a' ]);
                const values = loadValue();

                scope.assert.deepEqual(values.next(), { done: false, value: 'a' });
                scope.assert.deepEqual(values.next(), { done: true, value: undefined });
                scope.assert.deepEqual(values.next(), { done: true, value: undefined });
                scope.assert.equal(loadValue.iteratorEventCount, 3);
                scope.assert.deepEqual(
                    loadValue.iteratorEvents.map(function eventKind(event) {
                        return event.kind;
                    }),
                    [ 'yield', 'return', 'return' ]
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'reset detaches existing tracked iterators from history',
            metadata: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.yields([ 'a', 'b' ]);
                const values = loadValue();

                scope.assert.deepEqual(values.next(), { done: false, value: 'a' });
                loadValue.reset();
                scope.assert.deepEqual(values.next(), { done: false, value: 'b' });
                scope.assert.equal(loadValue.iteratorEventCount, 0);
                scope.assert.deepEqual(loadValue().next(), { done: false, value: 'a' });
                scope.assert.equal(loadValue.iteratorEventCount, 1);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'testDouble.yieldsAsync() records async iterator events after settlement',
            metadata: {},
            async body(scope: OverkillScope) {
                const loadValues = testDouble.yieldsAsync<LoadAsyncNumbers>([ 'a', 'b' ], 'done');
                const values = loadValues('scope');
                const pending = values.next(1);

                scope.assert.equal(loadValues.iteratorEventCount, 0);
                scope.assert.deepEqual(await pending, { done: false, value: 'a' });
                scope.assert.equal(loadValues.iteratorEventCount, 1);
                scope.assert.deepEqual(await values.next(2), { done: false, value: 'b' });
                scope.assert.deepEqual(await values.return('early'), { done: true, value: 'early' });
                scope.assert.deepEqual(
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

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'rule.yieldsAsyncFrom() delegates to sync and async sources',
            metadata: {},
            async body(scope: OverkillScope) {
                type LoadValues = (label: string) => AsyncGenerator<string, string, unknown>;

                const loadSyncValues = testDouble<LoadValues>({
                    fallback: rule.yieldsAsyncFrom<LoadValues>(function* loadSource(label) {
                        yield `${label}:sync`;
                        return `${label}:done`;
                    })
                });
                const loadAsyncValues = testDouble<LoadValues>({
                    fallback: rule.yieldsAsyncFrom<LoadValues>(async function* loadSource(label) {
                        yield `${label}:async`;
                        return `${label}:done`;
                    })
                });

                scope.assert.deepEqual(await loadSyncValues('a').next(), { done: false, value: 'a:sync' });
                scope.assert.deepEqual(await loadAsyncValues('b').next(), { done: false, value: 'b:async' });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
