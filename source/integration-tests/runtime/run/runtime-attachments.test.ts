import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import { attachmentFixture, attachmentWork as work } from '../../../test-support/attachment-fixture.ts';

import { defaultAttachmentLimits, type RuntimeAttachmentArtifact } from '../../../engine/runtime-attachment.ts';
import { attachmentsForProducer } from '../../../attachments/attachment-context.ts';
import { snapshotJson } from '../../../attachments/json-snapshot.ts';
import { runWithAttachmentExecution } from '../../../run/resource-lifecycle-state.ts';

const metadata = { mediaType: 'text/plain', name: 'service-log' };

const assertRetainedBinary = defineCompositeAssertion({
    name: 'retained binary',
    async assert(check, artifact: RuntimeAttachmentArtifact) {
        const initialChecks = check.equal(artifact.payload.content.kind, 'file');
        const { content } = artifact.payload;
        if (content.kind !== 'file') {
            throw new Error('Expected retained binary content.');
        }
        return check.group([
            initialChecks,
            check.deepEqual(Array.from(await readFile(path.resolve(content.path))), [ 1, 2, 3 ]),
            check.deepEqual(content.completion, { kind: 'incomplete', reason: 'byte-limit' })
        ]);
    }
});
const assertInvalidJson = defineCompositeAssertion({
    name: 'invalid json',
    assert(check) {
        const initialChecksBeforeNextAction = [
            undefined,
            1n,
            Number.NaN,
            new Date(),
            { value: undefined },
            Array.from({ length: 1 })
        ]
            .map(function (invalid) {
                return check.throws(function rejectInvalidJson() {
                    snapshotJson(invalid, 1024);
                }, { name: 'TypeError' });
            });
        const [ firstInvalidJsonCheck, ...remainingInvalidJsonChecks ] = initialChecksBeforeNextAction;
        if (firstInvalidJsonCheck === undefined) {
            throw new Error('Expected JSON validation checks.');
        }
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return check.group([
            check.group([ firstInvalidJsonCheck, ...remainingInvalidJsonChecks ]),
            check.throws(function rejectCyclicJson() {
                snapshotJson(cyclic, 1024);
            }, { name: 'TypeError' })
        ]);
    }
});

export const testNode = suite('Runtime attachments', [
    test('writers preserve attempt ownership, UTF-8 chunks, and idempotent close', async function (scope: TestScope) {
        const { execution, store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        await runWithAttachmentExecution(execution, async function runAttachmentTest() {
            await execution.runAttempt(work, { index: 2 }, async function writeAttemptLog() {
                const attachments = attachmentsForProducer({ kind: 'case' });
                const writer = await attachments.open({ ...metadata, kind: 'text' });
                const bytes = Buffer.from('hi 🌍');
                await writer.write(bytes.subarray(0, 5));
                await writer.write(bytes.subarray(5));
                const artifact = await writer.close();
                scope.assert.deepEqual(artifact.payload.content, {
                    byteLength: 7,
                    completion: { kind: 'complete' },
                    kind: 'text',
                    text: 'hi 🌍'
                });
                scope.assert.deepEqual(await writer.close(), artifact);
                scope.require.defined(artifact.id.attempt);
                scope.assert.deepEqual(artifact.id.attempt, { index: 2 });
            });
        });
        scope.assert.equal(store.artifacts().length, 1);
        return scope.assert.collect();
    }),
    test('unclosed writers preserve content and report one artifact error', async function (scope: TestScope) {
        const { execution, store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
        await runWithAttachmentExecution(execution, async function runAttachmentTest() {
            await execution.runAttempt(work, { index: 0 }, async function abandonWriter() {
                const writer = await attachmentsForProducer({ kind: 'resource', name: 'service' }).open({
                    ...metadata,
                    kind: 'text'
                });
                await writer.write('last log');
            });
        });
        const errors = execution.takeErrors({ attempt: { index: 0 }, kind: 'case', work });
        scope.assert.equal(errors.length, 1);
        scope.assert.equal(errors[0]?.subtype, 'artifact');
        scope.assert.equal(execution.takeErrors({ attempt: { index: 0 }, kind: 'case', work }).length, 0);
        const content = store.artifacts()[0]?.payload.content;
        scope.require.defined(content);
        scope.assert.deepEqual(content, {
            byteLength: 8,
            completion: { kind: 'incomplete', reason: 'unclosed' },
            kind: 'text',
            text: 'last log'
        });
        return scope.assert.collect();
    }),
    test('text truncates and binary overflow rejects while retaining its prefix', async function (scope: TestScope) {
        const limits = { ...defaultAttachmentLimits, maxArtifactBytes: 3, maxInlineBytes: 3 };
        const { execution, store } = await attachmentFixture(scope.cleanup, limits);
        await runWithAttachmentExecution(execution, async function runAttachmentTest() {
            const attachments = attachmentsForProducer({ kind: 'case' });
            const text = await attachments.open({ ...metadata, kind: 'text' });
            await text.write('a🌍b');
            const artifact = await text.close();
            scope.assert.deepEqual(artifact.payload.content, {
                byteLength: 1,
                completion: { kind: 'truncated', reason: 'byte-limit' },
                kind: 'text',
                text: 'a'
            });
            const binary = await attachments.open({
                kind: 'binary',
                mediaType: 'image/png',
                name: 'screenshot'
            });
            await scope.assert.rejects(async function overflowScreenshot() {
                await binary.write(new Uint8Array([ 1, 2, 3, 4 ]));
            }, { message: 'Binary attachment byte limit exceeded.' });
        });
        await execution.finish();
        const artifact = store.artifacts()[1];
        scope.require.defined(artifact);
        await scope.assert(assertRetainedBinary, artifact);
        return scope.assert.collect();
    }),
    test('JSON snapshots preserve schemas and reject values JSON would silently change', function (scope: TestScope) {
        const value = { violations: [ { id: 'contrast', impact: 'serious' } ], shared: [ 1, 2 ] };
        const snapshot = snapshotJson(value, 1024);
        value.violations.length = 0;
        scope.require.defined(snapshot);
        if (snapshot.value === null || typeof snapshot.value !== 'object') {
            throw new Error('Expected JSON object.');
        }
        scope.assert.deepEqual(snapshot.value, {
            violations: [ { id: 'contrast', impact: 'serious' } ],
            shared: [ 1, 2 ]
        });
        scope.assert.equal(snapshotJson('large', 3), null);
        scope.assert(assertInvalidJson);
        return scope.assert.collect();
    })
]);
