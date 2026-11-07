import { z } from 'zod/v4';
import type { RunResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import { runJsonArtifact } from '../attachments/run-json-artifact.ts';
import type { BaselineWriteOutcome } from '../baselines/baseline-model.ts';
import {
    storedOrdinaryBaselineSchema,
    type OrdinaryBaselineChange,
    type StoredOrdinaryBaseline
} from './baseline-record.ts';

export type OrdinaryBaselineReport = {
    readonly version: 1;
    readonly changes: readonly OrdinaryBaselineChange[];
    readonly warnings: readonly string[];
    readonly writeOutcome: BaselineWriteOutcome<StoredOrdinaryBaseline>;
};
const changeSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('create'), baseline: storedOrdinaryBaselineSchema }),
    z.strictObject({ kind: z.literal('remove'), baseline: storedOrdinaryBaselineSchema }),
    z.strictObject({
        kind: z.literal('update'),
        baseline: storedOrdinaryBaselineSchema,
        previous: storedOrdinaryBaselineSchema
    })
]);
const reportSchema: z.ZodType<OrdinaryBaselineReport> = z.strictObject({
    version: z.literal(1),
    changes: z.array(changeSchema),
    warnings: z.array(z.string()),
    writeOutcome: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('blocked') }),
        z.strictObject({ kind: z.literal('read-only') }),
        z.strictObject({ kind: z.literal('written'), changes: z.array(changeSchema) }),
        z.strictObject({ kind: z.literal('failed'), writtenChanges: z.array(changeSchema) })
    ])
});
const mediaType = 'application/vnd.overkill.baselines+json';
export function ordinaryBaselineReportArtifact(
    result: RunResult,
    report: OrdinaryBaselineReport,
    maxBytes: number
): RuntimeAttachmentArtifact {
    return runJsonArtifact({
        result,
        value: report,
        maxBytes,
        capturedAtMicroseconds: 0,
        mediaType,
        name: 'baselines'
    });
}
export function readOrdinaryBaselineReport(result: RunResult): OrdinaryBaselineReport | null {
    for (const artifact of result.artifacts) {
        if (
            artifact.payload.kind === 'runtime-attachment' && artifact.payload.mediaType === mediaType &&
            artifact.payload.content.kind === 'json' && artifact.id.scope.kind === 'run'
        ) {
            return reportSchema.parse(artifact.payload.content.value);
        }
    }
    return null;
}
