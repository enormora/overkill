import { runIfMain } from '#test-runner';
import { createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { attachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';

const metadata = { mediaType: 'application/json', name: 'evidence' };
async function assertMissingSourceFile(scope: TestScope): Promise<void> {
    const { execution, store, directory } = await attachmentFixture(scope, defaultAttachmentLimits);
    await execution.runAttempt(work, { index: 0 }, async function copyMissingSource() {
        await scope.assert.rejects(async function missingFile() {
            await execution.context.forProducer({ kind: 'case' }).file(metadata, `${directory}/missing.log`);
        }, { name: 'AttachmentOperationError' });
    });
    scope.assert.equal(execution.takeErrors({ kind: 'case', work, attempt: { index: 0 } }).length, 1);
    const content = store.artifacts()[0]?.payload.content;
    scope.require.defined(content);
    if (content.kind !== 'file') {
        throw new Error('Expected a retained file.');
    }
    scope.assert.deepEqual(content.completion, { kind: 'incomplete', reason: 'write-error' });
    scope.assert.equal(content.byteLength, 0);
}
export const testNode = createTestCase({
    title: 'file read errors retain incomplete evidence and fail the owning attempt',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    async body(scope: TestScope) {
        await assertMissingSourceFile(scope);
        return scope.assert.collect();
    }
});
await runIfMain(import.meta, testNode);
