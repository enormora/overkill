import {
    createSuite,
    createTestCase,
    type HedgedConflictArtifact,
    type TestScope
} from '../packages/engine/engine.entry-point.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import { attachmentFixture, attachmentWork } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits, type RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { supervisedChildMessageSchema, supervisedParentMessageSchema } from './supervised-protocol-schema.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';

const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
function decode(message: unknown): SupervisedChildMessage | null {
    return envelopeMessage(childProcessEnvelope('run', message), 'run', supervisedChildMessageSchema);
}
function createConflictEvidence(attachment: RuntimeAttachmentArtifact): HedgedConflictArtifact {
    const evidence: HedgedConflictArtifact['payload']['authoritative'] = {
        attachments: [ attachment ],
        attempts: [ { attempt: { index: 1 }, durationMicroseconds: 0, outcome: null, verdict: 'pass' } ],
        outcome: null,
        verdict: 'pass'
    };
    return {
        id: { ...attachment.id, subtype: 'hedged-conflict' },
        source: 'native',
        payload: {
            kind: 'hedged-conflict',
            work: attachmentWork,
            authoritative: evidence,
            conflicting: evidence
        }
    };
}
function assertAttachmentResult(scope: TestScope, attachment: RuntimeAttachmentArtifact): void {
    const result = runResultFactory.build({ artifacts: [ attachment ] });
    const conflict = createConflictEvidence(attachment);
    const message = { kind: 'result', result: { ...result, artifacts: [ attachment, conflict ] } };
    const serialized = JSON.stringify(message);
    const wireMessage: unknown = JSON.parse(serialized);
    scope.assert.deepEqual({ received: decode(wireMessage) }, { received: wireMessage });
    scope.assert.throws(function invalidAttachmentContent() {
        return decode({
            ...message,
            result: {
                ...result,
                artifacts: [ {
                    ...attachment,
                    payload: {
                        ...attachment.payload,
                        content: { ...attachment.payload.content, byteLength: 'invalid' }
                    }
                } ]
            }
        });
    }, { message: 'Invalid child-process IPC payload.' });
}
export const testNode = createSuite({
    title: 'child process attachment payloads',
    ...metadata,
    children: [
        createTestCase({
            title: 'attachment endpoints survive assignment decoding and reject invalid limits',
            ...metadata,
            body(scope) {
                const assignment = {
                    kind: 'assign',
                    assignedWork: [],
                    attachmentEndpoint: {
                        port: 1234,
                        token: 'attachment-token',
                        branch: null,
                        limits: defaultAttachmentLimits
                    }
                };
                scope.assert.deepEqual(supervisedParentMessageSchema.parse(assignment), assignment);
                scope.assert.false(
                    supervisedParentMessageSchema
                        .safeParse({
                            ...assignment,
                            attachmentEndpoint: {
                                ...assignment.attachmentEndpoint,
                                limits: { ...defaultAttachmentLimits, maxArtifactBytes: 'invalid' }
                            }
                        })
                        .success
                );
                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'completed results retain attachments and hedged evidence while rejecting malformed content',
            ...metadata,
            async body(scope: TestScope) {
                const { execution, store } = await attachmentFixture(scope, defaultAttachmentLimits);
                await execution.runAttempt(attachmentWork, { index: 1 }, async function captureEvidence() {
                    await execution.context.forProducer({ kind: 'case' }).json({
                        name: 'evidence',
                        mediaType: 'application/json'
                    }, { ready: true });
                });
                const attachment = store.artifacts()[0];
                scope.require.defined(attachment);
                assertAttachmentResult(scope, attachment);
                return scope.assert.collect();
            }
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
