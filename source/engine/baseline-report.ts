import type {
    SnapshotBaselineReport,
    BenchmarkBaselineReport,
    CalibrationReferenceReport
} from '../baselines/baseline-values.ts';

export type BaselineRunReport = {
    readonly kind: 'benchmark';
    readonly report: BenchmarkBaselineReport;
} | {
    readonly kind: 'calibration';
    readonly report: CalibrationReferenceReport;
} | {
    readonly kind: 'snapshot';
    readonly report: SnapshotBaselineReport;
};

export type BaselineReportSummary = {
    readonly kind: BaselineRunReport['kind'];
    readonly summary: {
        readonly outcome: 'blocked' | 'failed' | 'read-only' | 'written';
        readonly proposedChanges: number;
        readonly writtenChanges: number;
        readonly comparisons: number;
        readonly mismatches: number;
        readonly warnings: number;
    };
};
