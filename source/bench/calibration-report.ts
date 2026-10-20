import type { ReadonlyDeep } from 'type-fest';
import { z } from 'zod/v4';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { RunResult } from '../engine/run-result.ts';
import { runJsonArtifact } from '../attachments/run-json-artifact.ts';

const calibrationReferenceReportSchema = z.strictObject({
    version: z.literal(1),
    changes: z.array(z.strictObject({ kind: z.enum([ 'remove', 'write' ]), path: z.string() })),
    completed: z.array(z.string()),
    outcome: z.enum([ 'written', 'read-only', 'failed', 'blocked' ])
});
export type CalibrationReferenceReport = ReadonlyDeep<z.infer<typeof calibrationReferenceReportSchema>>;
const calibrationReferenceMediaType = 'application/vnd.overkill.calibration-references+json';
export function readCalibrationReferenceReport(result: RunResult): CalibrationReferenceReport | null {
    for (const artifact of result.artifacts) {
        const { payload } = artifact;
        const runAttachment = artifact.id.scope.kind === 'run' && payload.kind === 'runtime-attachment';
        if (runAttachment && payload.mediaType === calibrationReferenceMediaType && payload.content.kind === 'json') {
            return calibrationReferenceReportSchema.parse(payload.content.value);
        }
    }
    return null;
}
type CalibrationReportInput = {
    readonly result: RunResult;
    readonly report: CalibrationReferenceReport;
    readonly maxBytes: number;
    readonly capturedAtMicroseconds: number;
};
export function calibrationReferenceReportArtifact(input: CalibrationReportInput): RuntimeAttachmentArtifact {
    return runJsonArtifact({
        ...input,
        value: calibrationReferenceReportSchema.parse(input.report),
        name: 'calibration-references',
        mediaType: calibrationReferenceMediaType
    });
}
