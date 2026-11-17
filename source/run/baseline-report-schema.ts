import { z } from 'zod/v4';
import type { BaselineRunReport, BaselineReportSummary } from '../engine/baseline-report.ts';
import type { BaselineWriteOutcome } from '../baselines/baseline-model.ts';
import { calibrationReferenceReportSchema } from '../bench/calibration-report.ts';
import { reportSchema as benchmark } from '../baselines/performance-report.ts';
import { reportSchema as snapshot } from './baseline-report.ts';

export const baselineReportsSchema = z.array(z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('calibration'), report: calibrationReferenceReportSchema }),
    z.strictObject({ kind: z.literal('snapshot'), report: snapshot }),
    z.strictObject({ kind: z.literal('benchmark'), report: benchmark })
]));

export const baselineReportSummariesSchema: z.ZodType<readonly BaselineReportSummary[]> = z.array(z.strictObject({
    kind: z.enum([ 'calibration', 'snapshot', 'benchmark' ]),
    summary: z.strictObject({
        outcome: z.enum([ 'blocked', 'failed', 'read-only', 'written' ]),
        proposedChanges: z.number().int().nonnegative(),
        writtenChanges: z.number().int().nonnegative(),
        comparisons: z.number().int().nonnegative(),
        mismatches: z.number().int().nonnegative(),
        warnings: z.number().int().nonnegative()
    })
}));
function writtenChangeCount(outcome: BaselineWriteOutcome<unknown>): number {
    if (outcome.kind === 'written') {
        return outcome.changes.length;
    }
    return outcome.kind === 'failed' ? outcome.writtenChanges.length : 0;
}
function isBaselineReportSummary(report: BaselineRunReport | BaselineReportSummary): report is BaselineReportSummary {
    return Object.hasOwn(report, 'summary');
}
export function summarizeBaselineReports(
    reports: readonly (BaselineReportSummary | BaselineRunReport)[]
): readonly BaselineReportSummary[] {
    return reports.map(function summarize(report) {
        if (isBaselineReportSummary(report)) {
            return report;
        }
        if (report.kind === 'calibration') {
            return {
                kind: report.kind,
                summary: {
                    outcome: report.report.outcome,
                    proposedChanges: report.report.changes.length,
                    writtenChanges: report.report.completed.length,
                    comparisons: 0,
                    mismatches: 0,
                    warnings: 0
                }
            };
        }
        const comparisons = report.kind === 'benchmark' ? report.report.comparisons : [];
        return {
            kind: report.kind,
            summary: {
                outcome: report.report.writeOutcome.kind,
                proposedChanges: report.report.changes.length,
                writtenChanges: writtenChangeCount(report.report.writeOutcome),
                comparisons: comparisons.length,
                mismatches: comparisons
                    .filter(function mismatched(comparison) {
                        return comparison.observation.kind === 'observed' &&
                            comparison.observation.comparison?.kind === 'mismatch';
                    })
                    .length,
                warnings: report.kind === 'snapshot' ? report.report.warnings.length : 0
            }
        };
    });
}
