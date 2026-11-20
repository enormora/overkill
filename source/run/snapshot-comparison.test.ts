import { AsyncResource } from 'node:async_hooks';
import { type TestNode, table, suite, test } from '@overkill-dev/test';

import { evaluateSnapshot, type SnapshotInput } from '../baselines/snapshot-context.ts';
import { executeSnapshot, storedSnapshot, snapshotWire as wire } from '../test-support/snapshot-fixture.ts';
import { attachmentWork } from '../test-support/attachment-fixture.ts';
import { runWithSnapshotRun } from './execution-session-context.ts';
import { runSnapshotAttempt } from './snapshot-attempt.ts';

const textInput: SnapshotInput = { kind: 'text', name: 'response', actual: 'hello' };

const matchingInputs: readonly SnapshotInput[] = [
    textInput,
    { kind: 'bytes', name: 'bytes', actual: new Uint8Array([ 0, 255 ]) },
    ...[ null, true, 42, 'value', [ 1, null ], { active: true } ].map(function valueInput(actual) {
        return { kind: 'value', name: 'value', actual } as const;
    })
];

export const testNode: TestNode = suite('snapshot comparison and proposals', [
    table({
        title: 'compares matching inputs as one assertion',
        cases: matchingInputs,
        caseTitle(input) {
            return input.kind === 'value' ? `value: ${JSON.stringify(input.actual)}` : input.kind;
        },
        async test(scope) {
            const input = scope.parameters;

            const result = await executeSnapshot({ ...wire, entries: [ storedSnapshot(input) ] }, input);
            scope.assert.equal(result.status, 'passed');
            scope.assert.equal(result.summary.passed, 1);
            return scope.assert.collect();
        }
    }),
    table({
        title: 'rejects changed JSON content',
        cases: [
            { description: 'changed property', input: { actual: { active: true }, expected: { active: false } } },
            { description: 'reordered array', input: { actual: [ 1, 2 ], expected: [ 2, 1 ] } },
            { description: 'object replaced by boolean', input: { actual: true, expected: { active: true } } },
            { description: 'boolean replaced by object', input: { actual: { active: true }, expected: true } }
        ] as const,
        caseTitle({ description }) {
            return description;
        },
        async test(scope) {
            const { input } = scope.parameters;

            const actual: SnapshotInput = { kind: 'value', name: 'value', actual: input.actual };
            const expected = storedSnapshot({ ...actual, actual: input.expected });
            const result = await executeSnapshot({ ...wire, entries: [ expected ] }, actual);
            scope.assert.equal(result.status, 'failed');
            return scope.assert.collect();
        }
    }),
    test('rejects changed byte content', async function (scope) {
        const actual: SnapshotInput = { kind: 'bytes', name: 'bytes', actual: new Uint8Array([ 0, 255 ]) };
        const expected = storedSnapshot({ ...actual, actual: new Uint8Array([ 255, 0 ]) });
        const result = await executeSnapshot({ ...wire, entries: [ expected ] }, actual);
        scope.assert.equal(result.status, 'failed');
        return scope.assert.collect();
    }),
    table({
        title: 'handles missing and changed snapshot expectations',
        cases: [ 'none', 'bootstrap', 'update', 'apply', 'diff' ] as const,
        caseTitle(mode) {
            return mode;
        },
        async test(scope) {
            const mode = scope.parameters;

            const missing = await executeSnapshot({ ...wire, mode }, textInput);
            scope.assert.equal(missing.status, mode === 'none' ? 'failed' : 'passed');
            const existing = storedSnapshot({ ...textInput, actual: 'previous' });
            const changed = await executeSnapshot({ ...wire, mode, entries: [ existing ] }, textInput);
            scope.assert.equal(changed.status, mode === 'none' || mode === 'bootstrap' ? 'failed' : 'passed');
            return scope.assert.collect();
        }
    }),
    test('keeps a foreign profile expectation missing', async function (scope) {
        const existing = { ...storedSnapshot(textInput), profile: 'foreign' };
        const result = await executeSnapshot({ ...wire, entries: [ existing ] }, textInput);
        scope.assert.equal(result.status, 'failed');
        return scope.assert.collect();
    }),
    test('rejects blank names and callbacks retained past their attempt', async function (scope) {
        await scope.assert.rejects(async function blankName() {
            await executeSnapshot(wire, { ...textInput, name: '  ' });
        }, { message: 'Snapshot names must be nonblank and unique within each attempt.' });
        const late = await runWithSnapshotRun(wire, async function retainAttempt() {
            return await runSnapshotAttempt(attachmentWork, async function bindSnapshot() {
                return AsyncResource.bind(async function lateSnapshot() {
                    return await evaluateSnapshot(textInput);
                });
            });
        });
        await scope.assert.rejects(late, { message: 'Snapshot attempt has completed.' });
        return scope.assert.collect();
    })
]);
