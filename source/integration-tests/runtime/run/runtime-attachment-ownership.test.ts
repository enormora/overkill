import { test, type TestScope } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../../../engine/runtime-attachment.ts';
import { attachmentFixture, attachmentWork as work } from '../../../test-support/attachment-fixture.ts';

const metadata = { mediaType: 'application/json', name: 'evidence' };

export const testNode = test(
    'file read errors retain incomplete evidence and fail the owning attempt',
    async function (scope: TestScope) {
        const { execution, store, directory } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
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

        return scope.assert.collect();
    }
);
