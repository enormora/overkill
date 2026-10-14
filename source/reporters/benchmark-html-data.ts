import type { BenchmarkBudgetResult, BenchmarkMetricSummary } from '../engine/benchmark-result.ts';
import type { PerformanceMetricComparison } from '../baselines/performance-adapter.ts';
import type { RunSummary } from '../engine/run-result.ts';

type BenchmarkChartRow = {
    readonly key: string;
    readonly label: string;
    readonly summary: BenchmarkMetricSummary;
    readonly budgets: readonly BenchmarkBudgetResult[];
    readonly box: readonly number[];
    readonly histogram: readonly number[];
    readonly sampleCount: number;
    readonly sampleNote: string;
};
export type BenchmarkChartGroup = {
    readonly name: string;
    readonly unit: string;
    readonly bins: readonly string[];
    readonly rows: readonly BenchmarkChartRow[];
};
export type BaselineChartRow = PerformanceMetricComparison & {
    readonly group: string;
    readonly label: string;
    readonly outcome: string;
};
export type BenchmarkHtmlChartData = {
    readonly groups: readonly BenchmarkChartGroup[];
    readonly baselines: readonly BaselineChartRow[];
};
export type BenchmarkHtmlReport = {
    readonly charts: BenchmarkHtmlChartData;
    readonly status: string;
    readonly summary: RunSummary;
    readonly metadata: string;
    readonly cases: readonly { readonly label: string; readonly verdict: string; readonly details: string; }[];
    readonly baselineDetails: string;
    readonly diagnostics: readonly string[];
};
