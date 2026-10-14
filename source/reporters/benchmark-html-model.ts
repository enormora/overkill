import { canonicalIdentityJson } from '../canonical-identity.ts';
import { readBenchmarkRunMetadata } from '../bench/benchmark-run-report.ts';
import type { PerformanceBaselineEvidence } from '../baselines/performance-presentation.ts';
import { readPerformanceBaselineReport, type PerformanceBaselineReport } from '../baselines/performance-report.ts';
import { formatCaseId, workIdentityKey } from '../engine/identity.ts';
import type { RunResult } from '../engine/run-result.ts';
import type { BenchmarkHtmlReport, BaselineChartRow } from './benchmark-html-data.ts';
import { benchmarkMetricGroups, formatBenchmarkWorkload } from './benchmark-html-metrics.ts';

const jsonIndentation = 2;
function baselineOutcome(comparison: PerformanceBaselineEvidence, baseline: PerformanceBaselineReport): string {
    const { observation } = comparison;
    if (observation.kind !== 'observed') {
        return observation.kind;
    }
    if (observation.comparison !== null) {
        return observation.comparison.kind;
    }
    const change = baseline.changes.find(function matchingChange(candidate) {
        return candidate.baseline.adapter === comparison.adapter &&
            workIdentityKey(candidate.baseline.work) === workIdentityKey(comparison.work);
    });
    if (change !== undefined) {
        return `${change.kind} / ${baseline.writeOutcome.kind}`;
    }
    return observation.expected === null ? 'missing baseline' : 'no change proposed';
}
function baselineRows(baseline: PerformanceBaselineReport | null): readonly BaselineChartRow[] {
    if (baseline === null) {
        return [];
    }
    return baseline.comparisons.flatMap(function baselineCharts(comparison) {
        if (comparison.presentation.kind !== 'available') {
            return [];
        }
        return comparison.presentation.metrics.map(function metricChart(metric) {
            return {
                ...metric,
                group: canonicalIdentityJson([
                    comparison.work.case,
                    comparison.adapter,
                    metric.name,
                    metric.unit,
                    metric.scale
                ]),
                label: `${formatCaseId(comparison.work.case)} / ${
                    formatBenchmarkWorkload({ workId: comparison.work })
                } / ${comparison.adapter}`,
                outcome: baselineOutcome(comparison, baseline)
            };
        });
    });
}
export function createBenchmarkHtmlReport(result: RunResult): BenchmarkHtmlReport {
    const metadata = readBenchmarkRunMetadata(result);
    const baseline = readPerformanceBaselineReport(result);
    if (
        metadata === null && baseline === null && result.perTest.every(function measured(test) {
            return test.benchmark === null;
        })
    ) {
        throw new Error('Benchmark HTML reporter requires benchmark result evidence.');
    }
    return {
        charts: { groups: benchmarkMetricGroups(result), baselines: baselineRows(baseline) },
        status: result.status,
        summary: result.summary,
        metadata: metadata === null
            ? 'Machine/process metadata not recorded.'
            : JSON.stringify(metadata, null, jsonIndentation),
        cases: result.perTest.map(function caseDetails(test) {
            return {
                label: `${formatCaseId(test.id)} / ${formatBenchmarkWorkload(test)}`,
                verdict: test.verdict,
                details: JSON.stringify(
                    { benchmark: test.benchmark, outcome: test.outcome, attempts: test.attempts },
                    null,
                    jsonIndentation
                )
            };
        }),
        baselineDetails: baseline === null
            ? 'No performance baseline comparison was configured.'
            : JSON.stringify(baseline, null, jsonIndentation),
        diagnostics: result.runnerErrors.map(function runnerDiagnostic(error) {
            return `${error.subtype}: ${error.message}`;
        })
    };
}
