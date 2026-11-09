import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod/v4';
import { baselineIdentityKey, planBaselineChange } from '../baselines/baseline-planning.ts';
import type { BaselineIdentity, BaselineUpdateMode } from '../baselines/baseline-model.ts';
import type { RunArtifact } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { WorkId } from '../engine/identity.ts';
import { snapshotIdentity, snapshotMediaType } from './snapshot-identity.ts';
import {
    storedOrdinaryBaselineSchema,
    type StoredOrdinaryBaseline,
    type OrdinaryBaselineChange
} from './baseline-record.ts';

const evidenceSchema = z.strictObject({
    version: z.literal(1),
    name: z.string().min(1),
    format: z.enum([ 'text', 'value', 'bytes' ]),
    payload: storedOrdinaryBaselineSchema.shape.payload
});
type SnapshotEvidence = Readonly<z.infer<typeof evidenceSchema>>;
type EvidenceInput = {
    readonly artifacts: readonly RunArtifact[];
    readonly profile: string;
    readonly work: WorkId;
    readonly mode: BaselineUpdateMode;
    readonly existing: ReadonlyMap<string, StoredOrdinaryBaseline>;
    readonly projectRoot: string;
};
type EvidenceChanges = {
    readonly identities: readonly BaselineIdentity[];
    readonly changes: readonly OrdinaryBaselineChange[];
};
type EvaluatedEvidence = {
    readonly identity: BaselineIdentity;
    readonly change: OrdinaryBaselineChange | null;
};

function isSnapshotArtifact(artifact: RunArtifact): artifact is RuntimeAttachmentArtifact {
    return artifact.payload.kind === 'runtime-attachment' && artifact.payload.mediaType === snapshotMediaType;
}

async function readEvidence(artifact: RuntimeAttachmentArtifact, projectRoot: string): Promise<SnapshotEvidence> {
    const { content } = artifact.payload;
    if (content.kind === 'json') {
        return evidenceSchema.parse(content.value);
    }
    if (content.kind !== 'file' || content.completion.kind !== 'complete') {
        throw new TypeError('Snapshot evidence must contain complete JSON.');
    }
    const value: unknown = JSON.parse(await readFile(path.resolve(projectRoot, content.path), 'utf8'));
    return evidenceSchema.parse(value);
}

function evaluateEvidence(input: EvidenceInput, evidence: SnapshotEvidence): EvaluatedEvidence {
    const identity = snapshotIdentity(input.profile, input.work, evidence.name, evidence.format);
    const baseline: StoredOrdinaryBaseline = {
        ...identity,
        subtype: 'content-snapshot',
        version: 1,
        payload: evidence.payload
    };
    return {
        identity,
        change: planBaselineChange({
            mode: input.mode,
            existing: input.existing.get(baselineIdentityKey(identity)) ?? null,
            propose() {
                return baseline;
            },
            equals(left, right) {
                return JSON.stringify(left.payload) === JSON.stringify(right.payload);
            }
        })
    };
}

export async function snapshotEvidence(input: EvidenceInput): Promise<EvidenceChanges> {
    const observed = await Promise.all(
        input.artifacts.filter(isSnapshotArtifact).map(async function observation(artifact) {
            return evaluateEvidence(input, await readEvidence(artifact, input.projectRoot));
        })
    );
    return {
        identities: observed.map(function participating(entry) {
            return entry.identity;
        }),
        changes: observed.flatMap(function proposed(entry) {
            return entry.change === null ? [] : [ entry.change ];
        })
    };
}
