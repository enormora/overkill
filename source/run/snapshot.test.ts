import { writeFile } from 'node:fs/promises';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    runWithAttachmentContext,
    defaultAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import { evaluateSnapshot } from '../baselines/snapshot-context.ts';
import { attachmentFixture, attachmentWork, type AttachmentFixture } from '../test-support/attachment-fixture.ts';
import { snapshotEvidence } from './snapshot-evidence.ts';
import { runWithSnapshotRun } from './execution-session-context.ts';
import { runSnapshotAttempt } from './snapshot-attempt.ts';
import { captureSnapshot, snapshotComparisonValue } from './snapshot-value.ts';
import { isSnapshotExecutionError } from './snapshot-error.ts';

async function duplicateNames(scope: TestScope): Promise<void> {
    await evaluateSnapshot({ kind: 'text', name: 'é', actual: 'first' });
    try {
        await evaluateSnapshot({ kind: 'text', name: 'é', actual: 'second' });
    } catch (error: unknown) {
        scope.assert.true(isSnapshotExecutionError(error));
    }
}

async function runRecordedSnapshot(fixture: AttachmentFixture, body: () => Promise<void>): Promise<void> {
    const snapshots = runSnapshotAttempt.bind(null, attachmentWork, body);
    const ownedAttempt = fixture.execution.runAttempt.bind(null, attachmentWork, { index: 0 }, snapshots);
    const attachedAttempt = runWithAttachmentContext.bind(null, fixture.execution.context, ownedAttempt);
    await runWithSnapshotRun({ profile: 'integration', mode: 'update', maxBytes: 1024, entries: [] }, attachedAttempt);
}

async function recordedFileSnapshot(fixture: AttachmentFixture): Promise<void> {
    const file = `${fixture.directory}/snapshot.json`;
    await writeFile(
        file,
        JSON.stringify({ version: 1, name: 'response', format: 'text', payload: { kind: 'text', text: 'hello' } })
    );
    await runRecordedSnapshot(fixture, async function recordedFile() {
        await fixture.execution.context.forProducer({ kind: 'case' }).file({
            name: 'response',
            mediaType: 'application/vnd.overkill.snapshot+json'
        }, file);
    });
}

export const testNode = suite('content snapshot boundaries', [
    test('captures stable JSON without changing string contents', function (scope) {
        const first = captureSnapshot({ kind: 'value', name: 'json', actual: { b: 'é', a: [ -0, null ] } }, 1024);
        const second = captureSnapshot({ kind: 'value', name: 'json', actual: { a: [ 0, null ], b: 'é' } }, 1024);
        scope.assert.deepEqual(first, second);
        scope.assert.deepEqual(snapshotComparisonValue(first, 'value'), { a: [ 0, null ], b: 'é' });
        return scope.assert.collect();
    }),
    test('copies binary values and enforces byte limits', function (scope) {
        const bytes = new Uint8Array([ 0, 127, 255 ]);
        Object.defineProperty(bytes, Symbol.iterator, {
            value: function* unrelatedValues() {
                yield 42;
            }
        });
        const payload = captureSnapshot({ kind: 'bytes', name: 'binary', actual: bytes }, 3);
        bytes.fill(0);
        scope.assert.deepEqual(snapshotComparisonValue(payload, 'bytes'), new Uint8Array([ 0, 127, 255 ]));
        scope.assert.throws(function oversizedSnapshot() {
            captureSnapshot({ kind: 'text', name: 'text', actual: 'éé' }, 3);
        }, { message: 'Snapshot exceeds its byte limit.' });
        scope.assert.throws(function incompatiblePayload() {
            snapshotComparisonValue({ kind: 'text', text: 'bytes' }, 'bytes');
        }, { message: 'Snapshot payload does not match its format.' });
        return scope.assert.collect();
    }),
    test('rejects snapshots outside enabled execution', async function (scope) {
        await scope.assert.rejects(async function unmanagedSnapshot() {
            await evaluateSnapshot({ kind: 'text', name: 'text', actual: 'actual' });
        }, { message: 'Snapshots require an integration profile with baselines.snapshots enabled.' });
        return scope.assert.collect();
    }),
    test('rejects invalid payload types and JSON byte overflow', function (scope) {
        for (
            const [ input, maxBytes, message ] of [
                [ { kind: 'text', actual: 42 }, 1024, 'Text snapshots require string values.' ],
                [ { kind: 'bytes', actual: [] }, 1024, 'Binary snapshots require Uint8Array values.' ],
                [ { kind: 'value', actual: 'oversized' }, 2, 'Snapshot exceeds its byte limit.' ],
                [ { kind: 'value', actual: { a: 1 } }, 8, 'Snapshot exceeds its byte limit.' ]
            ] as const
        ) {
            scope.assert.throws(function invalidSnapshot() {
                Reflect.apply(captureSnapshot, null, [ { ...input, name: 'invalid' }, maxBytes ]);
            }, { message });
        }
        return scope.assert.collect();
    }),
    test('rejects non-finite JSON values without invoking accessors', function (scope) {
        scope.assert.throws(function nonFiniteSnapshot() {
            captureSnapshot({ kind: 'value', name: 'number', actual: Number.NaN }, 1024);
        }, { message: 'Attachments require finite JSON values.' });
        let reads = 0;
        const value = {
            get property() {
                reads += 1;
                return 'value';
            }
        };
        scope.assert.throws(function accessorSnapshot() {
            captureSnapshot({ kind: 'value', name: 'object', actual: value }, 1024);
        }, { message: 'JSON attachments cannot contain sparse arrays or accessors.' });
        scope.assert.equal(reads, 0);
        return scope.assert.collect();
    }),
    test('reads complete snapshot evidence from managed files', async function (scope: TestScope) {
        const fixture = await attachmentFixture(scope, { ...defaultAttachmentLimits, maxInlineBytes: 1 });
        await recordedFileSnapshot(fixture);
        const artifacts = fixture.store.artifacts();
        scope.assert.equal(artifacts[0]?.payload.content.kind, 'file');
        const observed = await snapshotEvidence({
            artifacts,
            profile: 'integration',
            work: attachmentWork,
            mode: 'update',
            existing: new Map(),
            projectRoot: process.cwd()
        });
        scope.assert.equal(observed.changes.length, 1);
        const [ change ] = observed.changes;
        scope.require.defined(change);
        scope.assert.deepEqual(change.baseline.payload, { kind: 'text', text: 'hello' });
        return scope.assert.collect();
    }),
    test('blocks an attempt even when a duplicate-name error is caught', async function (scope) {
        const fixture = await attachmentFixture(scope, defaultAttachmentLimits);
        await scope.assert.rejects(async function duplicateAttempt() {
            await runRecordedSnapshot(fixture, duplicateNames.bind(null, scope));
        }, { message: 'Snapshot names must be nonblank and unique within each attempt.' });
        return scope.assert.collect();
    })
]);
