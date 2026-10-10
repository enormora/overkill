import { z } from 'zod/v4';
import { snapshotJson } from '../attachments/json-snapshot.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { RuntimeAttachmentArtifact } from '../engine/runtime-attachment.ts';
import type { ComparableCalibration } from '../packages/run/benchmark-calibration.entry-point.ts';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import { storedPerformanceBaselineSchema } from './performance-schema.ts';
import type { BaselineChange, BaselineWriteOutcome } from './performance-baseline.ts';

export type PerformanceBaselineReport = {
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
const reportSchema: z.ZodType<PerformanceBaselineReport> = z.strictObject({
    calibration: comparableCalibrationSchema,
    changes: z.array(changeSchema),
    writeOutcome: writeOutcomeSchema
});
const reportMediaType = 'application/vnd.overkill.performance-baselines+json';

type PerformanceReportArtifactInput = {
    readonly capturedAtMicroseconds: number;
    readonly maxBytes: number;
    readonly report: PerformanceBaselineReport;
    readonly result: RunResult;
};

export function performanceReportArtifact(input: PerformanceReportArtifactInput): RuntimeAttachmentArtifact {
    const snapshot = snapshotJson(input.report, input.maxBytes);
    if (snapshot === null) {
        throw new Error('Performance baseline report exceeds the configured artifact byte limit.');
    }
    const sequence = input.result.artifacts.reduce(function nextSequence(next, artifact) {
        return Math.max(next, artifact.id.sequence + 1);
    }, 0);
    return {
        id: { attempt: null, runtimes: [], scope: { kind: 'run' }, sequence, subtype: 'attachment', workload: null },
        payload: {
            capture: 'opt-in',
            capturedAtMicroseconds: input.capturedAtMicroseconds,
            content: { byteLength: Buffer.byteLength(snapshot.encoded), kind: 'json', value: snapshot.value },
            kind: 'runtime-attachment',
            mediaType: reportMediaType,
            name: 'performance-baselines',
            producer: { kind: 'case' }
        },
        source: 'native'
    };
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
