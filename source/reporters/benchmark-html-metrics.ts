import type {
    BenchmarkBudgetResult,
    BenchmarkMetricSummary,
    BenchmarkExecutionResult
} from '../engine/benchmark-result.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { createBenchmarkSampleReader, type BenchmarkSampleEvidence } from '../bench/benchmark-sample-report.ts';
import { caseIdentityKey, formatCaseId, workIdentityKey } from '../engine/identity.ts';
import type { PerTestResult, RunResult } from '../engine/run-result.ts';
import { metricNormalizationEvidence } from '../bench/metric-normalization-evidence.ts';
import type { BenchmarkChartGroup } from './benchmark-html-data.ts';
import { distributionScale, histogramLabels, sampleBox, sampleHistogram } from './benchmark-html-distribution.ts';

type MetricRow = {
    readonly test: MeasuredTest;
    readonly name: string;
    readonly summary: BenchmarkMetricSummary;
    readonly values: readonly number[];
    readonly note: string;
    readonly scale: string;
    readonly budgets: readonly BenchmarkBudgetResult[];
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
function rawMetricRow(
    test: MeasuredTest,
    name: string,
    summary: BenchmarkMetricSummary,
    samples: BenchmarkSampleEvidence
): MetricRow {
    const retained = samples.kind === 'available' ? samples.metrics : {};
    const budgets = metricNormalizationEvidence(test.benchmark.normalization ?? null, name) === null
        ? test.benchmark.budgets.filter(function matchingBudget(budget) {
            return budget.metric === name;
        })
        : [];
    return { test, name, summary, values: retained[name] ?? [], note: sampleNote(samples), scale: 'raw', budgets };
}
function normalizedMetricRow(row: MetricRow): MetricRow | null {
    const normalized = metricNormalizationEvidence(row.test.benchmark.normalization ?? null, row.name);
    if (normalized === null) {
        return null;
    }
    if (normalized.summary === null || normalized.factor === null) {
        return null;
    }
    const scale = [
        'normalized',
        normalized.reference.machineClass,
        normalized.reference.identity.workload.name,
        normalized.reference.identity.version,
        normalized.source
    ]
        .join(' / ');
    const factor = normalized.factor.estimate;
    const note = 'Thresholds use the fixed budget reference; decisions include calibration uncertainty.';
    return {
        ...row,
        summary: normalized.summary,
        values: row.values.map(function normalizedValue(value) {
            return value * factor;
        }),
        note: `${row.note} ${note}`,
        scale,
        budgets: normalized.budgets
    };
}
function metricRowKey(row: MetricRow): string {
    const reference = row.scale === 'raw'
        ? 'raw'
        : metricNormalizationEvidence(row.test.benchmark.normalization ?? null, row.name)?.reference;
    return canonicalIdentityJson([ caseIdentityKey(row.test.id), row.name, row.summary.provenance, reference ]);
}
function appendMetricRows(record: RecordMetricRow, samples: BenchmarkSampleEvidence, test: MeasuredTest): void {
    for (const [ name, summary ] of Object.entries(test.benchmark.metrics)) {
        const row = rawMetricRow(test, name, summary, samples);
        record(metricRowKey(row), row);
        const normalized = normalizedMetricRow(row);
        if (normalized !== null) {
            record(metricRowKey(normalized), normalized);
        }
    }
}
function metricScaleLabel(row: MetricRow): string {
    return [ row.summary.provenance.collector, row.summary.provenance.scope, row.scale ].join(', ');
}
export function benchmarkMetricGroups(result: RunResult): readonly BenchmarkChartGroup[] {
    const readSamples = createBenchmarkSampleReader(result);
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
        appendMetricRows(recordRow, readSamples(test), test);
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
            name: `${formatCaseId(first.test.id)} / ${first.name} (${metricScaleLabel(first)})`,
            unit: first.summary.provenance.unit,
            bins: histogramLabels(scale),
            rows: rows.map(function chartRow(row) {
                return {
                    key: workIdentityKey(row.test.workId),
                    label: formatBenchmarkWorkload(row.test),
                    summary: row.summary,
                    budgets: row.budgets,
                    box: sampleBox(row.values),
                    histogram: sampleHistogram(row.values, scale),
                    sampleCount: row.values.length,
                    sampleNote: row.note
                };
            })
        };
    });
}
