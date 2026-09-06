import { createLineReporter as createOverkillLineReporter } from '../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DoubleCall } from './double-history-record.ts';
import { rule } from './double-rule.ts';
import { testDouble, type TestDouble } from './test-double.ts';

type SnapshotInput = {
    readonly id: string;
};
type SnapshotOutput = {
    readonly id: string;
};
type SnapshotLoader = (input: SnapshotInput) => SnapshotOutput;
type MutableArraySnapshot = {
    readonly push: (value: unknown) => number;
};
type RecordedSnapshotLoader = {
    readonly actual: SnapshotOutput;
    readonly input: SnapshotInput;
    readonly loadValue: TestDouble<SnapshotLoader>;
    readonly output: SnapshotOutput;
};

function createRecordedSnapshotLoader(): RecordedSnapshotLoader {
    const input: SnapshotInput = { id: 'input' };
    const output: SnapshotOutput = { id: 'output' };
    const loadValue = testDouble.returns<SnapshotLoader>(output);
    const actual = loadValue(input);

    return { actual, input, loadValue, output };
}

export const testSuite = createOverkillSuite({
    title: 'source/doubles/test-double-history.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            title: 'history array snapshots are shallow copies',
            metadata: {},
            body(scope: OverkillScope) {
                const { actual, input, loadValue, output } = createRecordedSnapshotLoader();
                const calls = loadValue.calls as unknown as unknown[];

                calls.push({ kind: 'call' });

                scope.assert.equal(actual, output);
                scope.assert.equal(loadValue.callCount, 1);
                const { firstCall } = loadValue;
                scope.require.notNull(firstCall);
                scope.assert.deepEqual(firstCall.arguments, [ input ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history record snapshots are shallow copies',
            metadata: {},
            body(scope: OverkillScope) {
                const { actual, input, loadValue, output } = createRecordedSnapshotLoader();
                const firstCall = loadValue.firstCall as DoubleCall | null;

                scope.assert.equal(actual, output);
                scope.require.notNull(firstCall);
                const mutableArguments = firstCall.arguments as unknown as MutableArraySnapshot;

                mutableArguments.push('changed');
                Object.defineProperty(firstCall, 'index', { value: 99 });

                scope.assert.deepEqual(
                    {
                        arguments: loadValue.firstCall?.arguments,
                        index: loadValue.firstCall?.index
                    },
                    {
                        arguments: [ input ],
                        index: 0
                    }
                );

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history result snapshots keep value references',
            metadata: {},
            body(scope: OverkillScope) {
                const { actual, loadValue, output } = createRecordedSnapshotLoader();
                const outputResult = loadValue.firstResult;

                scope.assert.equal(actual, output);
                scope.require.notNull(outputResult);
                scope.assert.equal(outputResult.status, 'returned');
                scope.require.hasProperty(outputResult, 'value');
                scope.assert.equal(outputResult.value, output);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'history properties are non-enumerable',
            metadata: {},
            body(scope: OverkillScope) {
                const loadValue = testDouble.returns('value');

                loadValue('id');

                scope.assert.equal(loadValue.interactionCount, 1);
                scope.assert.deepEqual(Object.keys(loadValue), []);
                scope.assert.deepEqual(Object.entries(loadValue), []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'reset clears history and restarts indexes',
            metadata: {},
            body(scope: OverkillScope) {
                type LoadValue = (id: string) => string;

                const seen: unknown[] = [];
                const loadValue = testDouble<LoadValue>({
                    answer(invocation) {
                        seen.push(invocation);

                        return `${invocation.index}:${invocation.arguments[0]}`;
                    }
                });

                scope.assert.equal(loadValue('a'), '0:a');
                loadValue.reset();
                scope.assert.equal(loadValue.interactionCount, 0);
                scope.assert.equal(loadValue('b'), '0:b');
                scope.assert.deepEqual(seen, [
                    { arguments: [ 'a' ], index: 0, kind: 'call' },
                    { arguments: [ 'b' ], index: 0, kind: 'call' }
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'reset rewinds ordered rules and sequence behaviors',
            metadata: {},
            body(scope: OverkillScope) {
                type LoadValue = () => string;

                const loadValue = testDouble<LoadValue>({
                    rules: [ rule.onCall(0).returns('first') ],
                    fallback: rule.sequence([ 'second', 'third' ])
                });

                scope.assert.equal(loadValue(), 'first');
                scope.assert.equal(loadValue(), 'second');
                loadValue.reset();
                scope.assert.equal(loadValue(), 'first');
                scope.assert.equal(loadValue(), 'second');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            title: 'sequence behavior state is independent per double',
            metadata: {},
            body(scope: OverkillScope) {
                type LoadValue = () => string;

                const sequence = rule.sequence([ 'first', 'second' ]);
                const firstLoadValue = testDouble<LoadValue>({ fallback: sequence });
                const secondLoadValue = testDouble<LoadValue>({ fallback: sequence });

                scope.assert.equal(firstLoadValue(), 'first');
                scope.assert.equal(secondLoadValue(), 'first');
                scope.assert.equal(firstLoadValue(), 'second');
                scope.assert.equal(secondLoadValue(), 'second');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
