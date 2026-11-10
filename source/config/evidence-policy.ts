import { z } from 'zod/v4';
import { defaultAttachmentLimits, type AttachmentLimits } from '../engine/runtime-attachment.ts';
import {
    defaultFailureArtifactPolicy,
    resolvedFailureArtifactPolicySchema,
    type FailureArtifactPolicy
} from '../engine/failure-artifact-policy.ts';

const positiveSafeIntegerSchema = z.number().refine(function isPositiveSafeInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}, 'must be a positive safe integer');

export const attachmentLimitsSchema = z
    .strictObject({
        maxInlineBytes: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxInlineBytes),
        maxArtifactBytes: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxArtifactBytes),
        maxScopeBytes: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxScopeBytes),
        maxScopeAttachments: positiveSafeIntegerSchema.default(defaultAttachmentLimits.maxScopeAttachments)
    })
    .readonly()
    .default(defaultAttachmentLimits);
const serializationLimits = resolvedFailureArtifactPolicySchema.shape.serialization.shape;
const renderingLimits = resolvedFailureArtifactPolicySchema.shape.rendering.shape;
const evidenceDefaults = defaultFailureArtifactPolicy;
export const failureArtifactPolicySchema = z
    .strictObject({
        capturedOutputBytes: resolvedFailureArtifactPolicySchema.shape.capturedOutputBytes.default(
            evidenceDefaults.capturedOutputBytes
        ),
        serialization: z
            .strictObject({
                arrayEntries: serializationLimits.arrayEntries.default(evidenceDefaults.serialization.arrayEntries),
                depth: serializationLimits.depth.default(evidenceDefaults.serialization.depth),
                objectEntries: serializationLimits.objectEntries.default(evidenceDefaults.serialization.objectEntries),
                operandBytes: serializationLimits.operandBytes.default(evidenceDefaults.serialization.operandBytes),
                stringBytes: serializationLimits.stringBytes.default(evidenceDefaults.serialization.stringBytes),
                visitedNodes: serializationLimits.visitedNodes.default(evidenceDefaults.serialization.visitedNodes)
            })
            .prefault({}),
        rendering: z
            .strictObject({
                diffLines: renderingLimits.diffLines.default(evidenceDefaults.rendering.diffLines),
                valueBytes: renderingLimits.valueBytes.default(evidenceDefaults.rendering.valueBytes)
            })
            .prefault({})
    })
    .prefault({});

export type ProfileEvidencePolicy = {
    readonly attachments: AttachmentLimits;
    readonly failureArtifacts: FailureArtifactPolicy;
};
