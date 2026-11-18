import { z } from 'zod/v4';
import type { SnapshotBaselineReport } from '../baselines/baseline-values.ts';
import type { RunResult } from '../engine/run-result.ts';
import {
    storedOrdinaryBaselineSchema
} from './baseline-record.ts';

export type OrdinaryBaselineReport = SnapshotBaselineReport;
const changeSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('create'), baseline: storedOrdinaryBaselineSchema }),
    z.strictObject({ kind: z.literal('remove'), baseline: storedOrdinaryBaselineSchema }),
    z.strictObject({
        kind: z.literal('update'),
        baseline: storedOrdinaryBaselineSchema,
        previous: storedOrdinaryBaselineSchema
    })
]);
export const reportSchema: z.ZodType<OrdinaryBaselineReport> = z.strictObject({
    changes: z.array(changeSchema),
    warnings: z.array(z.string()),
    writeOutcome: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('blocked') }),
        z.strictObject({ kind: z.literal('read-only') }),
        z.strictObject({ kind: z.literal('written'), changes: z.array(changeSchema) }),
        z.strictObject({ kind: z.literal('failed'), writtenChanges: z.array(changeSchema) })
    ])
});
export function withOrdinaryBaselineReport(
    result: RunResult,
    report: OrdinaryBaselineReport,
    maxBytes: number
): RunResult {
    if (Buffer.byteLength(JSON.stringify(report)) > maxBytes) {
        throw new Error('Baseline comparison evidence exceeds the configured byte limit.');
    }
    return { ...result, baselineReports: [ ...result.baselineReports, { kind: 'snapshot', report } ] };
}
export function readOrdinaryBaselineReport(result: RunResult): OrdinaryBaselineReport | null {
    return result
        .baselineReports
        .find(function snapshot(value) {
            return value.kind === 'snapshot';
        })
        ?.report ?? null;
}
