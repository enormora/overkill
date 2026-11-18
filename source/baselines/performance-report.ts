import { z } from 'zod/v4';
import type { RunResult } from '../engine/run-result.ts';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import type { BenchmarkBaselineReport } from './baseline-values.ts';
import { performanceEvidenceSchema } from './performance-presentation.ts';
import { storedPerformanceBaselineSchema } from './performance-schema.ts';
import type { BaselineChange, BaselineWriteOutcome } from './performance-baseline.ts';

export type PerformanceBaselineReport = BenchmarkBaselineReport;
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
export const reportSchema: z.ZodType<PerformanceBaselineReport> = z.strictObject({
    calibration: comparableCalibrationSchema,
    changes: z.array(changeSchema),
    writeOutcome: writeOutcomeSchema,
    comparisons: z.array(performanceEvidenceSchema)
});
type PerformanceReportInput = {
    readonly maxBytes: number;
    readonly report: PerformanceBaselineReport;
    readonly result: RunResult;
};
export function withPerformanceBaselineReport(input: PerformanceReportInput): RunResult {
    if (Buffer.byteLength(JSON.stringify(input.report)) > input.maxBytes) {
        throw new Error('Benchmark comparison evidence exceeds the configured byte limit.');
    }
    return {
        ...input.result,
        baselineReports: [ ...input.result.baselineReports, {
            kind: 'benchmark',
            report: input.report
        } ]
    };
}
export function readPerformanceBaselineReport(result: RunResult): PerformanceBaselineReport | null {
    return result
        .baselineReports
        .find(function benchmark(value) {
            return value.kind === 'benchmark';
        })
        ?.report ?? null;
}
