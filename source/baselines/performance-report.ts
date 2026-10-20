import { z } from 'zod/v4';
import { runJsonArtifact } from '../attachments/run-json-artifact.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { ComparableCalibration } from '../bench/host-calibration-result.ts';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import { performanceEvidenceSchema, type PerformanceBaselineEvidence } from './performance-presentation.ts';
import { storedPerformanceBaselineSchema } from './performance-schema.ts';
import type { BaselineChange, BaselineWriteOutcome } from './performance-baseline.ts';

const reportVersion = 2;
export type PerformanceBaselineReport = {
    readonly version: typeof reportVersion;
    readonly comparisons: readonly PerformanceBaselineEvidence[];
    readonly calibration: ComparableCalibration;
    readonly changes: readonly BaselineChange[];
    readonly writeOutcome: BaselineWriteOutcome;
};
const changeSchema: z.ZodType<BaselineChange> = z.discriminatedUnion('kind', [
    z.strictObject({ baseline: storedPerformanceBaselineSchema, kind: z.literal('create') }),
    z.strictObject({ baseline: storedPerformanceBaselineSchema, kind: z.literal('remove') }),
    z.strictObject({
        baseline: storedPerformanceBaselineSchema,
        kind: z.literal('update'),
        previous: storedPerformanceBaselineSchema
    })
]);
const writeOutcomeSchema: z.ZodType<BaselineWriteOutcome> = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('read-only') }),
    z.strictObject({ kind: z.literal('blocked') }),
    z.strictObject({ changes: z.array(changeSchema), kind: z.literal('written') }),
    z.strictObject({ kind: z.literal('failed'), writtenChanges: z.array(changeSchema) })
]);
const legacyReportSchema = z.strictObject({
    calibration: comparableCalibrationSchema,
    changes: z.array(changeSchema),
    writeOutcome: writeOutcomeSchema
});
const reportSchema: z.ZodType<PerformanceBaselineReport> = z.union([
    legacyReportSchema.transform(function upgradeReport(report): PerformanceBaselineReport {
        return { ...report, version: reportVersion, comparisons: [] };
    }),
    legacyReportSchema.extend({ version: z.literal(reportVersion), comparisons: z.array(performanceEvidenceSchema) })
]);
const reportMediaType = 'application/vnd.overkill.performance-baselines+json';

type PerformanceReportArtifactInput = {
    readonly capturedAtMicroseconds: number;
    readonly maxBytes: number;
    readonly report: PerformanceBaselineReport | z.infer<typeof legacyReportSchema>;
    readonly result: RunResult;
};

export function performanceReportArtifact(input: PerformanceReportArtifactInput): RuntimeAttachmentArtifact {
    return runJsonArtifact({
        ...input,
        name: 'performance-baselines',
        mediaType: reportMediaType,
        value: input.report
    });
}

export function readPerformanceBaselineReport(result: RunResult): PerformanceBaselineReport | null {
    for (const artifact of result.artifacts) {
        if (
            artifact.payload.kind === 'runtime-attachment' && artifact.payload.mediaType === reportMediaType &&
            artifact.payload.content.kind === 'json' && artifact.id.scope.kind === 'run'
        ) {
            return reportSchema.parse(artifact.payload.content.value);
        }
    }
    return null;
}
