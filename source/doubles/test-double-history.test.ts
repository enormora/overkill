import assert from 'node:assert/strict';
import { registerTest } from '../test-support/register-test.ts';
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
    readonly input: SnapshotInput;
    readonly loadValue: TestDouble<SnapshotLoader>;
    readonly output: SnapshotOutput;
};

function requireRecordedValue<Value>(value: Value | null, message: string): Value {
    if (value === null) {
        assert.fail(message);
    }

    return value;
}

function createRecordedSnapshotLoader(): RecordedSnapshotLoader {
    const input: SnapshotInput = { id: 'input' };
    const output: SnapshotOutput = { id: 'output' };
    const loadValue = testDouble.returns<SnapshotLoader>(output);

    assert.equal(loadValue(input), output);

    return { input, loadValue, output };
}

registerTest('history array snapshots are shallow copies', function () {
    const { input, loadValue } = createRecordedSnapshotLoader();
    const calls = loadValue.calls as unknown as unknown[];

    calls.push({ kind: 'call' });

    assert.equal(loadValue.callCount, 1);
    assert.deepEqual(requireRecordedValue(loadValue.firstCall, 'expected fresh call').arguments, [ input ]);
});

registerTest('history record snapshots are shallow copies', function () {
    const { input, loadValue } = createRecordedSnapshotLoader();
    const firstCall = requireRecordedValue(loadValue.firstCall, 'expected recorded call') as DoubleCall;
    const mutableArguments = firstCall.arguments as unknown as MutableArraySnapshot;

    mutableArguments.push('changed');
    Object.defineProperty(firstCall, 'index', { value: 99 });

    assert.deepEqual(requireRecordedValue(loadValue.firstCall, 'expected fresh call').arguments, [ input ]);
    assert.equal(requireRecordedValue(loadValue.firstCall, 'expected fresh call').index, 0);
});

registerTest('history result snapshots keep value references', function () {
    const { loadValue, output } = createRecordedSnapshotLoader();
    const outputResult = requireRecordedValue(loadValue.firstResult, 'expected returned output');

    if (outputResult.status !== 'returned') {
        assert.fail('expected returned output');
    }
    assert.equal(outputResult.value, output);
});

registerTest('history properties are non-enumerable', function () {
    const loadValue = testDouble.returns('value');

    loadValue('id');

    assert.equal(loadValue.interactionCount, 1);
    assert.deepEqual(Object.keys(loadValue), []);
    assert.deepEqual(Object.entries(loadValue), []);
});

registerTest('reset clears history and restarts indexes', function () {
    type LoadValue = (id: string) => string;

    const seen: unknown[] = [];
    const loadValue = testDouble<LoadValue>({
        answer(invocation) {
            seen.push(invocation);

            return `${invocation.index}:${invocation.arguments[0]}`;
        }
    });

    assert.equal(loadValue('a'), '0:a');
    loadValue.reset();
    assert.equal(loadValue.interactionCount, 0);
    assert.equal(loadValue('b'), '0:b');
    assert.deepEqual(seen, [
        { arguments: [ 'a' ], index: 0, kind: 'call' },
        { arguments: [ 'b' ], index: 0, kind: 'call' }
    ]);
});

registerTest('reset rewinds ordered rules and sequence behaviors', function () {
    type LoadValue = () => string;

    const loadValue = testDouble<LoadValue>({
        rules: [ rule.onCall(0).returns('first') ],
        fallback: rule.sequence([ 'second', 'third' ])
    });

    assert.equal(loadValue(), 'first');
    assert.equal(loadValue(), 'second');
    loadValue.reset();
    assert.equal(loadValue(), 'first');
    assert.equal(loadValue(), 'second');
});

registerTest('sequence behavior state is independent per double', function () {
    type LoadValue = () => string;

    const sequence = rule.sequence([ 'first', 'second' ]);
    const firstLoadValue = testDouble<LoadValue>({ fallback: sequence });
    const secondLoadValue = testDouble<LoadValue>({ fallback: sequence });

    assert.equal(firstLoadValue(), 'first');
    assert.equal(secondLoadValue(), 'first');
    assert.equal(firstLoadValue(), 'second');
    assert.equal(secondLoadValue(), 'second');
});
