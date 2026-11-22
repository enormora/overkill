import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { suite, test, type TestScope } from '@overkill-dev/test';

import type { HedgedConflictArtifact } from '../packages/engine/engine.entry-point.ts';

import { runResultFactory } from '../test-support/run-result-factory.ts';
import { attachmentFixture, attachmentWork } from '../test-support/attachment-fixture.ts';
import { defaultAttachmentLimits, type RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { childProcessEnvelope, envelopeMessage } from './child-process-protocol.ts';
import { supervisedParentMessageSchema } from './supervised-parent-message-schema.ts';
import { supervisedChildMessageSchema } from './supervised-child-message-schema.ts';
import type { SupervisedChildMessage } from './supervised-protocol.ts';

function decode(message: unknown): SupervisedChildMessage | null {
    return envelopeMessage(childProcessEnvelope('run', message), 'run', supervisedChildMessageSchema);
}
function createConflictEvidence(attachment: RuntimeAttachmentArtifact): HedgedConflictArtifact {
    const evidence: HedgedConflictArtifact['payload']['authoritative'] = {
        attachments: [ attachment ],
        attempts: [ {
            property: null,
            benchmark: null,
            attempt: { index: 1 },
            durationMicroseconds: 0,
            outcome: null,
            verdict: 'pass'
        } ],
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
const assertAttachmentResult = defineCompositeAssertion({
    name: 'attachment result',
    assert(check, attachment: RuntimeAttachmentArtifact) {
        const result = runResultFactory.build({ artifacts: [ attachment ] });
        const conflict = createConflictEvidence(attachment);
        const message = { kind: 'result', result: { ...result, artifacts: [ attachment, conflict ] } };
        const serialized = JSON.stringify(message);
        const wireMessage: unknown = JSON.parse(serialized);
        return check.group([
            check.deepEqual({ received: decode(wireMessage) }, { received: wireMessage }),
            check.throws(function invalidAttachmentContent() {
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
            }, { message: 'Invalid child-process IPC payload.' })
        ]);
    }
});
export const testNode = suite('child process attachment payloads', [
    test('attachment endpoints survive assignment decoding and reject invalid limits', function (scope) {
        const assignment = {
            workloadInputs: [],
            propertyPolicies: [],
            kind: 'assign',
            assignedWork: [],
            attachmentEndpoint: {
                port: 1234,
                token: 'attachment-token',
                branch: null,
                limits: defaultAttachmentLimits
            }
        };
        scope.assert.deepEqual(supervisedParentMessageSchema.parse(assignment), {
            ...assignment,
            implementations: null,
            corpus: { checkedIn: [], localCache: [], diagnostics: [] }
        });
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
    }),
    test(
        'completed results retain attachments and hedged evidence while rejecting malformed content',
        async function (scope: TestScope) {
            const { execution, store } = await attachmentFixture(scope.cleanup, defaultAttachmentLimits);
            await execution.runAttempt(attachmentWork, { index: 1 }, async function captureEvidence() {
                await execution.context.forProducer({ kind: 'case' }).json({
                    name: 'evidence',
                    mediaType: 'application/json'
                }, { ready: true });
            });
            const attachment = store.artifacts()[0];
            scope.require.defined(attachment);
            scope.assert(assertAttachmentResult, attachment);
            return scope.assert.collect();
        }
    )
]);
