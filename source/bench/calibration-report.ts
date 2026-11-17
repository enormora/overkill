import { z } from 'zod/v4';
import type { CalibrationReferenceReport as ReferenceReport } from '../baselines/baseline-values.ts';
import type { RunResult } from '../engine/run-result.ts';

export const calibrationReferenceReportSchema: z.ZodType<ReferenceReport> = z.strictObject({
    changes: z.array(z.strictObject({ kind: z.enum([ 'remove', 'write' ]), path: z.string() })),
    completed: z.array(z.string()),
    outcome: z.enum([ 'written', 'read-only', 'failed', 'blocked' ])
});
export type CalibrationReferenceReport = ReferenceReport;
export function readCalibrationReferenceReport(result: RunResult): CalibrationReferenceReport | null {
    return result
        .baselineReports
        .find(function calibration(report) {
            return report.kind === 'calibration';
        })
        ?.report ?? null;
}
type CalibrationReportInput = {
    readonly result: RunResult;
    readonly report: CalibrationReferenceReport;
    readonly maxBytes: number;
};
export function withCalibrationReferenceReport(input: CalibrationReportInput): RunResult {
    const report = calibrationReferenceReportSchema.parse(input.report);
    if (Buffer.byteLength(JSON.stringify(report)) > input.maxBytes) {
        throw new Error('Calibration reference report exceeds the configured byte limit.');
    }
    return { ...input.result, baselineReports: [ ...input.result.baselineReports, { kind: 'calibration', report } ] };
}
