import { table, type TestNode, suite, test } from '@overkill-dev/test';

import { defaultAttachmentLimits } from '../engine/runtime-attachment.ts';
import { inlineAttachmentFixture, attachmentWork as work } from '../test-support/attachment-fixture.ts';
import { openAttachmentWriter } from '../test-support/inline-attachment-writer.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import type { AttachmentOperation } from './attachment-protocol.ts';

const owner = { kind: 'case', work, attempt: { index: 0 } } as const;
const open: Extract<AttachmentOperation, { readonly kind: 'open'; }> = {
    kind: 'open',
    contentKind: 'text',
    owner,
    producer: { kind: 'case' },
    metadata: { name: 'evidence', mediaType: 'text/plain' },
    branch: null
};
export const testNode: TestNode = suite('inline attachment store protocol boundaries', [
    table({
        title: 'rejects invalid metadata',
        cases: ([ '', 'bad\u{0}name', 'bad\u{7F}name', 'x'.repeat(257) ] as const).flatMap(function (value, index) {
            return ([ 'name', 'mediaType' ] as const).map(function (field) {
                return ({ caseDescription: `${field}, ${index}`, value, index, field });
            });
        }),
        caseTitle: (row) => row.caseDescription,
        async test(scope) {
            const { value, field } = scope.parameters;

            const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            const reply = await store.exchange('channel', {
                ...open,
                metadata: { ...open.metadata, [field]: value }
            });
            scope.assert.deepEqual(reply, {
                kind: 'error',
                reason: 'operation-error',
                message: 'Attachment names and media types require 1 to 256 bytes without control characters.'
            });
            scope.assert.deepEqual(store.artifacts(), []);
            return scope.assert.collect();
        }
    }),
    test('rejects unknown branches before reserving a writer', async function (scope) {
        const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        scope.assert.deepEqual(await store.exchange('channel', { ...open, branch: 'unknown' }), {
            kind: 'error',
            reason: 'operation-error',
            message: 'Unknown attachment execution branch.'
        });
        scope.assert.deepEqual(store.artifacts(), []);
        return scope.assert.collect();
    }),
    test('rejects owners and resource consumers outside selected work', async function (scope) {
        const { store } = inlineAttachmentFixture(defaultAttachmentLimits, []);
        scope.assert.partialDeepEqual(await store.exchange('channel', open), {
            kind: 'error',
            message: 'Attachment owner is outside the selected work.'
        });
        scope.assert.partialDeepEqual(
            await store.exchange('channel', { kind: 'resource-consumer', boundary: 'resource', work }),
            { kind: 'error', message: 'Resource consumer is outside selected work.' }
        );
        scope.assert.deepEqual(store.artifacts(), []);
        return scope.assert.collect();
    }),
    test(
        'rejects writes from a different channel and preserves the original writer',
        async function (scope) {
            const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            const writer = await openAttachmentWriter(store, 'owner', open);
            scope.assert.partialDeepEqual(
                await store.exchange('other', {
                    kind: 'write',
                    writer,
                    data: Buffer.from('stolen').toString('base64')
                }),
                { kind: 'error', message: 'Unknown attachment writer.' }
            );
            await store.exchange('owner', { kind: 'write', writer, data: Buffer.from('owned').toString('base64') });
            await store.exchange('owner', { kind: 'close', writer, reason: 'complete' });
            scope.assert.partialDeepEqual(store.selectedArtifacts(), [ {
                payload: { content: { kind: 'text', text: 'owned', completion: { kind: 'complete' } } }
            } ]);
            return scope.assert.collect();
        }
    ),
    test(
        'finishes an unclosed opt-in writer and returns its owner exactly once',
        async function (scope) {
            const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            await openAttachmentWriter(store, 'owner', open);
            scope.assert.deepEqual(await store.finish(null), [ owner ]);
            scope.assert.partialDeepEqual(store.selectedArtifacts(), [ {
                payload: { content: { completion: { kind: 'incomplete', reason: 'unclosed' } } }
            } ]);
            scope.assert.deepEqual(await store.finish(null), []);
            return scope.assert.collect();
        }
    ),
    test(
        'finishes only the selected channel and marks interrupted shutdown',
        async function (scope) {
            const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            await openAttachmentWriter(store, 'first', open);
            await openAttachmentWriter(store, 'second', open);
            scope.assert.deepEqual(await store.finish('first'), [ owner ]);
            scope.assert.deepEqual(await store.finish('first'), []);
            scope.assert.deepEqual(await store.finish('second'), [ owner ]);
            scope.assert.partialDeepEqual(store.artifacts(), [ {
                payload: { content: { completion: { kind: 'incomplete', reason: 'interrupted' } } }
            }, { payload: { content: { completion: { kind: 'incomplete', reason: 'interrupted' } } } } ]);
            return scope.assert.collect();
        }
    ),
    test('discards owners and artifacts from rejected speculative branches', async function (scope) {
        const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
        store.registerBranch('discarded', function () {
            return false;
        });
        await openAttachmentWriter(store, 'owner', { ...open, branch: 'discarded' });
        scope.assert.deepEqual(await store.finish(null), []);
        scope.assert.deepEqual(store.selectedArtifacts(), []);
        scope.assert.equal(store.conflictArtifacts('discarded').length, 1);
        return scope.assert.collect();
    }),
    test(
        'marks run interruption and prunes discarded inline evidence without filesystem access',
        async function (scope) {
            const { store } = inlineAttachmentFixture(defaultAttachmentLimits, [ work ]);
            await openAttachmentWriter(store, 'owner', open);
            store.settleResult(
                runResultFactory.build({ runnerErrors: [ { subtype: 'crash', message: 'interrupted' } ] })
            );
            await store.finish(null);
            scope.assert.partialDeepEqual(store.artifacts(), [ {
                payload: { content: { completion: { kind: 'incomplete', reason: 'interrupted' } } }
            } ]);
            await store.prune([]);
            scope.assert.deepEqual(store.artifacts(), []);
            scope.assert.deepEqual(store.selectedArtifacts(), []);
            return scope.assert.collect();
        }
    )
]);
