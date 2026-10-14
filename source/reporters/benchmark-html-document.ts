import type { BaselineChartRow, BenchmarkHtmlReport } from './benchmark-html-data.ts';

function htmlText(value: unknown): string {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
function table(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
    return `<table><thead><tr>${
        headers
            .map(function heading(value) {
                return `<th>${htmlText(value)}</th>`;
            })
            .join('')
    }</tr></thead><tbody>${
        rows
            .map(function row(values) {
                return `<tr>${
                    values
                        .map(function cell(value) {
                            return `<td>${htmlText(value ?? 'unavailable')}</td>`;
                        })
                        .join('')
                }</tr>`;
            })
            .join('')
    }</tbody></table>`;
}
function metricTables(report: BenchmarkHtmlReport): string {
    return report
        .charts
        .groups
        .map(function metricGroup(group) {
            const metrics = table(
                [
                    'Workload / runtime',
                    'Unit',
                    'Available count',
                    'Mean',
                    'Median',
                    'Min',
                    'Max',
                    'Distribution evidence'
                ],
                group.rows.map(function metricRow(row) {
                    return [
                        row.label,
                        group.unit,
                        row.summary.count,
                        row.summary.mean,
                        row.summary.median,
                        row.summary.minimum,
                        row.summary.maximum,
                        `${row.sampleCount}: ${row.sampleNote}; ${row.summary.unavailableReasons.join('; ')}`
                    ];
                })
            );
            const budgets = table(
                [
                    'Workload',
                    'Statistic',
                    'Estimate',
                    'Interval lower',
                    'Interval upper',
                    'Minimum',
                    'Maximum',
                    'Precision met',
                    'Decision'
                ],
                group.rows.flatMap(function workloadBudgets(row) {
                    return row.budgets.map(function budgetRow(budget) {
                        return [
                            row.label,
                            JSON.stringify(budget.statistic),
                            budget.estimate,
                            budget.interval.lower ?? '-unbounded',
                            budget.interval.upper ?? 'unbounded',
                            budget.minimum ?? '-unbounded',
                            budget.maximum ?? 'unbounded',
                            budget.precise,
                            budget.decision
                        ];
                    });
                })
            );
            return `<section><h3>${htmlText(group.name)}</h3>${metrics}${budgets}</section>`;
        })
        .join('');
}
const percentMultiplier = 100;
function difference(actual: number | null, expected: number | null): number | null {
    if (actual === null || expected === null) {
        return null;
    }
    const delta = actual - expected;
    return Number.isFinite(delta) ? delta : null;
}
function percentDifference(actual: number | null, expected: number | null): number | null {
    const delta = difference(actual, expected);
    if (delta === null || expected === null || expected === 0) {
        return null;
    }
    const percent = delta / Math.abs(expected) * percentMultiplier;
    return Number.isFinite(percent) ? percent : null;
}
function baselineCells(row: BaselineChartRow): readonly unknown[] {
    const expected = row.expected.kind === 'value' ? row.expected.value : null;
    return [
        row.label,
        row.name,
        row.unit,
        JSON.stringify(row.scale),
        row.actual,
        JSON.stringify(row.expected),
        difference(row.actual, expected),
        percentDifference(row.actual, expected),
        difference(row.actual, row.expected.kind === 'range' ? row.expected.minimum : null),
        difference(row.actual, row.expected.kind === 'range' ? row.expected.maximum : null),
        row.outcome
    ];
}
function baselineTable(report: BenchmarkHtmlReport): string {
    return table(
        [
            'Benchmark / workload / adapter',
            'Metric',
            'Unit',
            'Scale',
            'Actual',
            'Expected',
            'Delta',
            'Delta %',
            'Delta from minimum',
            'Delta from maximum',
            'Policy outcome'
        ],
        report.charts.baselines.map(baselineCells)
    );
}
const styles = `
body {font:16px system-ui,sans-serif;background:#f4f6fa;color:#18243a;margin:0;padding:2rem}
main {max-width:1400px;margin:auto}
h1,h2,h3 {line-height:1.2}
section,details,.controls {background:white;padding:1rem;margin:1rem 0;border-radius:8px}
table {border-collapse:collapse;display:block;overflow:auto;width:100%;font-size:14px}
th,td {padding:.6rem;border-bottom:1px solid #d9e0ec;text-align:left;white-space:pre-wrap}
pre {white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
.charts {display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:1rem}
.chart {height:420px;background:white;padding:1rem;min-width:0}
label {display:block;margin:.5rem 0}
select {max-width:100%;padding:.5rem}
summary {cursor:pointer}
@media print {.controls{display:none}.charts{display:block}.chart{break-inside:avoid}}
`;
export function renderBenchmarkHtml(report: BenchmarkHtmlReport, clientSource: string): string {
    const charts = JSON.stringify(report.charts).replaceAll('<', '\\u003C');
    const cases = report
        .cases
        .map(function caseDetails(test) {
            const summary = `<summary>${htmlText(test.verdict)}: ${htmlText(test.label)}</summary>`;
            return `<details>${summary}<pre>${htmlText(test.details)}</pre></details>`;
        })
        .join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Benchmark report</title>
<style>${styles}</style></head><body><main>
<h1>Benchmark report: ${htmlText(report.status)}</h1><p>${htmlText(JSON.stringify(report.summary))}</p>
<h2>Interactive comparisons</h2>
<noscript>Charts require JavaScript. All recorded summaries and outcomes are available below.</noscript>
<div class="controls"><label>Metric <select id="metric-selection"></select></label>
<label>Workloads / runtimes <select id="workload-selection" multiple size="4"></select></label></div>
<p>Zoom with the sliders or scroll inside a chart. Boxes show descriptive retained-sample quantiles,
not confidence intervals. Unbounded interval endpoints remain explicit in the budget tables.</p>
<div class="charts"><div class="chart" id="distribution"></div><div class="chart" id="box"></div>
<div class="chart" id="workloads"></div><div class="chart" id="budgets"></div></div>
<h2>Workload metrics and budgets</h2>
<p>Budget estimates and recorded intervals retain the configured confidence and precision policy.</p>
${metricTables(report)}
<h2>Baseline comparisons</h2><label>Baseline metric <select id="baseline-selection"></select></label>
<div class="chart" id="baseline-chart"></div>${baselineTable(report)}
<p>Deltas are arithmetic differences, not improvement classifications. Percentage deltas use the absolute
reference magnitude and are unavailable for zero references. Range bounds are shown individually in charts.</p>
<details><summary>Baseline observations, comparison diagnostics, and completed writes</summary>
<pre>${htmlText(report.baselineDetails)}</pre></details>
<h2>Machine and process metadata</h2><pre>${htmlText(report.metadata)}</pre>
<h2>Cases and measurement policy</h2>${cases}
<h2>Runner diagnostics</h2><pre>${htmlText(report.diagnostics.join('\n'))}</pre>
</main><script>${clientSource}</script>
<script>window.renderBenchmarkCharts(${charts});</script></body></html>`;
}
