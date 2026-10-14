import { canonicalIdentityJson } from '../canonical-identity.ts';
import { readBenchmarkSamples, type BenchmarkSampleEvidence } from '../bench/benchmark-sample-report.ts';
import { caseIdentityKey, formatCaseId, workIdentityKey } from '../engine/identity.ts';
import type { PerTestResult, RunResult } from '../engine/run-result.ts';
import type { BenchmarkMetricSummary, BenchmarkExecutionResult } from '../engine/benchmark-result.ts';
import type { BenchmarkChartGroup } from './benchmark-html-data.ts';
import { distributionScale, histogramLabels, sampleBox, sampleHistogram } from './benchmark-html-distribution.ts';

type MetricRow = {
    readonly test: MeasuredTest;
    readonly name: string;
    readonly summary: BenchmarkMetricSummary;
    readonly values: readonly number[];
    readonly note: string;
};
export function formatBenchmarkWorkload(test: Pick<PerTestResult, 'workId'>): string {
    const runtimes = test
        .workId
        .runtimes
        .map(function runtimeLabel(runtime) {
            return `${runtime.name}:${runtime.variantId ?? 'default'} ${JSON.stringify(runtime.dimensions)}`;
        })
        .join(', ');
    const runtimeSuffix = runtimes.length === 0 ? '' : ` (${runtimes})`;
    return `${test.workId.workload?.name ?? 'default'}${runtimeSuffix}`;
}
function sampleNote(samples: BenchmarkSampleEvidence): string {
    if (samples.kind === 'unavailable') {
        return samples.reason;
    }
    return samples.partial ? 'Retained partial samples.' : 'Retained observations.';
}
type MeasuredTest = PerTestResult & { readonly benchmark: BenchmarkExecutionResult; };
type RecordMetricRow = (key: string, row: MetricRow) => void;
function appendMetricRows(record: RecordMetricRow, result: RunResult, test: MeasuredTest): void {
    const samples = readBenchmarkSamples(result, test);
    const entries = Object.entries(test.benchmark.metrics);
    const retained = samples.kind === 'available' ? samples.metrics : {};
    for (const [ name, summary ] of entries) {
        const key = canonicalIdentityJson([ caseIdentityKey(test.id), name, summary.provenance ]);
        record(key, { test, name, summary, values: retained[name] ?? [], note: sampleNote(samples) });
    }
}
export function benchmarkMetricGroups(result: RunResult): readonly BenchmarkChartGroup[] {
    const groups = new Map<string, MetricRow[]>();
    const measuredTests = result.perTest.filter(function measured(test): test is MeasuredTest {
        return test.benchmark !== null;
    });
    function recordRow(key: string, row: MetricRow): void {
        const rows = groups.get(key) ?? [];
        rows.push(row);
        groups.set(key, rows);
    }
    for (const test of measuredTests) {
        appendMetricRows(recordRow, result, test);
    }
    return Array.from(groups.values(), function chartGroup(rows) {
        const first = rows[0];
        if (first === undefined) {
            throw new Error('Metric group requires a row.');
        }
        const scale = distributionScale(rows.map(function observations(row) {
            return row.values;
        }));
        return {
            name: `${
                formatCaseId(first.test.id)
            } / ${first.name} (${first.summary.provenance.collector}, ${first.summary.provenance.scope}, raw)`,
            unit: first.summary.provenance.unit,
            bins: histogramLabels(scale),
            rows: rows.map(function chartRow(row) {
                return {
                    key: workIdentityKey(row.test.workId),
                    label: formatBenchmarkWorkload(row.test),
                    summary: row.summary,
                    budgets: row.test.benchmark.budgets.filter(function matchingBudget(budget) {
                        return budget.metric === row.name;
                    }),
                    box: sampleBox(row.values),
                    histogram: sampleHistogram(row.values, scale),
                    sampleCount: row.values.length,
                    sampleNote: row.note
                };
            })
        };
    });
}
