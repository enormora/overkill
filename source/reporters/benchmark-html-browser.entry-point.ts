import { init, use, type EChartsType } from 'echarts/core';
import type { EChartsOption, CustomSeriesRenderItem } from 'echarts';
import { BarChart, BoxplotChart, CandlestickChart, ScatterChart, CustomChart } from 'echarts/charts';
import {
    AriaComponent,
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    TooltipComponent,
    TitleComponent
} from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { BenchmarkBudgetResult } from '../engine/benchmark-result.ts';
import type { BenchmarkTimelineEvent } from '../engine/benchmark-timeline.ts';
import { difference, percentDifference } from './benchmark-deltas.ts';
import type { BenchmarkHtmlChartData, BenchmarkChartGroup, BaselineChartRow } from './benchmark-html-data.ts';

use([
    BarChart,
    BoxplotChart,
    CandlestickChart,
    ScatterChart,
    CustomChart,
    AriaComponent,
    DataZoomComponent,
    GridComponent,
    LegendComponent,
    MarkLineComponent,
    TooltipComponent,
    TitleComponent,
    SVGRenderer
]);

function chartAt(id: string): EChartsType {
    const element = document.querySelector(`#${id}`);
    if (element === null) {
        throw new Error(`Missing chart ${id}.`);
    }
    if (!(element instanceof HTMLElement)) {
        throw new TypeError('Chart requires an HTML element.');
    }
    const chart = init(element, null, { renderer: 'svg' });
    const observer = new ResizeObserver(function resized() {
        chart.resize();
    });
    observer.observe(element);
    return chart;
}
function selectionAt(id: string): HTMLSelectElement {
    const element = document.querySelector(`#${id}`);
    if (!(element instanceof HTMLSelectElement)) {
        throw new TypeError(`Missing selection ${id}.`);
    }
    return element;
}
function categoricalChart(title: string, labels: readonly string[], unit: string): EChartsOption {
    return {
        title: { text: title, textStyle: { fontSize: 16 } },
        animation: false,
        aria: { enabled: true },
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        legend: { top: 30 },
        grid: { top: 75, left: 80, right: 35, bottom: 85 },
        xAxis: { type: 'category', data: Array.from(labels), axisLabel: { hideOverlap: true } },
        yAxis: { type: 'value', name: unit, scale: true },
        dataZoom: [ { type: 'inside' }, { type: 'slider', bottom: 10 } ]
    };
}
type BudgetTooltipRow = readonly [name: string, value: number | null, unavailable: string];
function budgetTooltip(budget: BenchmarkBudgetResult, label: string): string {
    const rows: readonly BudgetTooltipRow[] = [
        [ 'estimate', budget.estimate, 'unavailable' ],
        [ 'interval lower', budget.interval.lower, '-unbounded' ],
        [ 'interval upper', budget.interval.upper, 'unbounded' ],
        [ 'minimum', budget.minimum, '-unbounded' ],
        [ 'minimum delta', difference(budget.estimate, budget.minimum), 'unavailable' ],
        [ 'minimum delta %', percentDifference(budget.estimate, budget.minimum), 'unavailable' ],
        [ 'maximum', budget.maximum, 'unbounded' ],
        [ 'maximum delta', difference(budget.estimate, budget.maximum), 'unavailable' ],
        [ 'maximum delta %', percentDifference(budget.estimate, budget.maximum), 'unavailable' ]
    ];
    return [
        label,
        ...rows.map(function recordedValue([ fieldLabel, value, unavailable ]) {
            return `${fieldLabel}: ${value ?? unavailable}`;
        }),
        `precision met: ${String(budget.precise)}`
    ]
        .join('\n');
}
function renderGroup(charts: WorkloadCharts, group: BenchmarkChartGroup, selected: ReadonlySet<string>): void {
    const rows = group.rows.filter(function selectedRow(row) {
        return selected.has(row.key);
    });
    const labels = rows.map(function workload(row) {
        return row.label;
    });
    charts.distribution.setOption({
        ...categoricalChart('Retained sample distributions', group.bins, 'sample count'),
        series: rows.map(function histogram(row) {
            return { type: 'bar' as const, name: row.label, data: Array.from(row.histogram) };
        })
    }, true);
    charts.box.setOption({
        ...categoricalChart('Empirical min / Q1 / median / Q3 / max', labels, group.unit),
        series: [ {
            type: 'boxplot',
            data: rows.map(function box(row) {
                return Array.from(row.box);
            })
        } ]
    }, true);
    charts.workloads.setOption({
        ...categoricalChart('Workload summaries', labels, group.unit),
        series: [
            {
                type: 'bar',
                name: 'mean',
                data: rows.map(function mean(row) {
                    return row.summary.mean;
                })
            },
            {
                type: 'bar',
                name: 'median',
                data: rows.map(function median(row) {
                    return row.summary.median;
                })
            }
        ]
    }, true);
    const budgets = rows.flatMap(function workloadBudgets(row) {
        return row.budgets.map(function labeledBudget(budget) {
            return {
                ...budget,
                label: `${row.label}: ${budget.statistic.kind}${
                    budget.statistic.kind === 'quantile' ? ` ${budget.statistic.probability}` : ''
                } (${budget.decision})`
            };
        });
    });
    charts.budgets.setOption({
        ...categoricalChart(
            'Budget estimates and recorded intervals',
            budgets.map(function label(budget) {
                return budget.label;
            }),
            group.unit
        ),
        tooltip: { trigger: 'item', renderMode: 'richText', formatter: '{b}' },
        series: [
            {
                type: 'candlestick',
                name: 'recorded interval',
                data: budgets.map(function interval(budget) {
                    return budget.estimate !== null && budget.interval.lower !== null && budget.interval.upper !== null
                        ? {
                            name: budgetTooltip(budget, budget.label),
                            value: [ budget.estimate, budget.estimate, budget.interval.lower, budget.interval.upper ]
                        }
                        : '-';
                })
            },
            {
                type: 'scatter',
                name: 'estimate',
                data: budgets.map(function estimate(budget) {
                    return { name: budgetTooltip(budget, budget.label), value: budget.estimate };
                })
            },
            {
                type: 'scatter',
                name: 'minimum',
                symbol: 'triangle',
                data: budgets.map(function minimum(budget) {
                    return { name: budgetTooltip(budget, budget.label), value: budget.minimum };
                })
            },
            {
                type: 'scatter',
                name: 'maximum',
                symbol: 'triangle',
                data: budgets.map(function maximum(budget) {
                    return { name: budgetTooltip(budget, budget.label), value: budget.maximum };
                })
            }
        ]
    }, true);
}
function baselineGroupKey(row: BaselineChartRow): string {
    return row.group;
}
function renderBaselines(chart: EChartsType, rows: readonly BaselineChartRow[]): void {
    const first = rows[0];
    chart.setOption({
        ...categoricalChart(
            `Baseline comparisons (${
                first
                    ?.scale
                    .kind ?? 'unavailable'
            })`,
            rows.map(function label(row) {
                return `${row.label}: ${row.outcome}`;
            }),
            first?.unit ?? ''
        ),
        series: [
            {
                type: 'bar',
                name: 'actual',
                data: rows.map(function actual(row) {
                    return row.actual;
                })
            },
            {
                type: 'bar',
                name: 'expected',
                data: rows.map(function expected(row) {
                    return row.expected.kind === 'value' ? row.expected.value : null;
                })
            },
            {
                type: 'scatter',
                name: 'minimum',
                data: rows.map(function minimum(row) {
                    return row.expected.kind === 'range' ? row.expected.minimum : null;
                })
            },
            {
                type: 'scatter',
                name: 'maximum',
                data: rows.map(function maximum(row) {
                    return row.expected.kind === 'range' ? row.expected.maximum : null;
                })
            }
        ]
    }, true);
}
type WorkloadCharts = {
    readonly distribution: EChartsType;
    readonly box: EChartsType;
    readonly workloads: EChartsType;
    readonly budgets: EChartsType;
};
function connectWorkloadSelection(data: BenchmarkHtmlChartData, charts: WorkloadCharts): void {
    const metricSelection = selectionAt('metric-selection');
    const workloadSelection = selectionAt('workload-selection');
    const entries = data.groups.entries();
    for (const [ index, group ] of entries) {
        metricSelection.add(new Option(group.name, String(index)));
    }
    function refreshCharts(): void {
        const group = data.groups[Number(metricSelection.value)];
        if (group !== undefined) {
            const selected = new Set(Array.from(workloadSelection.selectedOptions, function work(option) {
                return option.value;
            }));
            renderGroup(charts, group, selected);
        }
    }
    function refreshWorkloads(): void {
        const rows = data.groups[Number(metricSelection.value)]?.rows ?? [];
        workloadSelection.replaceChildren();
        for (const row of rows) {
            workloadSelection.add(new Option(row.label, row.key, true, true));
        }
        refreshCharts();
    }
    metricSelection.addEventListener('change', refreshWorkloads);
    workloadSelection.addEventListener('change', refreshCharts);
    refreshWorkloads();
}
function connectBaselineSelection(data: BenchmarkHtmlChartData): void {
    const selection = selectionAt('baseline-selection');
    const chart = chartAt('baseline-chart');
    const metrics = new Map(data.baselines.map(function metric(row) {
        return [ baselineGroupKey(row), row ];
    }));
    for (const [ key, row ] of metrics) {
        selection.add(
            new Option(`${row.label} / ${row.name} (${row.unit}, ${JSON.stringify(row.scale)})`, key)
        );
    }
    function refreshBaselines(): void {
        renderBaselines(
            chart,
            data.baselines.filter(function selectedBaseline(row) {
                return baselineGroupKey(row) === selection.value;
            })
        );
    }
    selection.addEventListener('change', refreshBaselines);
    refreshBaselines();
}
const timelineLaneIndex = 2;
const timelineHalfHeight = 5;
const timelineMinimumWidth = 2;
const renderTimelineEvent: CustomSeriesRenderItem = function renderEvent(_parameters, api) {
    const start = api.coord([ api.value(0), api.value(timelineLaneIndex) ]);
    const end = api.coord([ api.value(1), api.value(timelineLaneIndex) ]);
    return {
        type: 'rect',
        shape: {
            x: start[0] ?? 0,
            y: (start[1] ?? 0) - timelineHalfHeight,
            width: Math.max(timelineMinimumWidth, (end[0] ?? 0) - (start[0] ?? 0)),
            height: timelineHalfHeight + timelineHalfHeight
        },
        style: { fill: '#3865b4' }
    };
};
function renderTimeline(chart: EChartsType, events: readonly BenchmarkTimelineEvent[], clock: string): void {
    chart.setOption({
        title: { text: `Timeline / ${clock.length > 0 ? clock : 'no recorded events'}` },
        animation: false,
        aria: { enabled: true },
        tooltip: { renderMode: 'richText' },
        grid: { left: 190, right: 30, top: 60, bottom: 65 },
        xAxis: { type: 'value', name: 'raw microseconds', scale: true },
        yAxis: {
            type: 'category',
            data: events.map(function eventLabel(observation) {
                return `${observation.phase} ${observation.sample} / ${observation.name} (${observation.outcome})`;
            })
        },
        dataZoom: [ { type: 'inside' }, { type: 'slider' }, { type: 'slider', yAxisIndex: 0, right: 0 } ],
        series: [ {
            type: 'custom',
            renderItem: renderTimelineEvent,
            encode: { x: [ 0, 1 ], y: 2 },
            data: events.map(function eventInterval(observation, index) {
                return {
                    name: `${observation.name} / ${observation.source}`,
                    value: [
                        observation.startMicroseconds,
                        observation.startMicroseconds + (observation.durationMicroseconds ?? 0),
                        index
                    ]
                };
            })
        } ]
    }, true);
}
function timelineSelections(): Readonly<Record<'clock' | 'phase' | 'sample' | 'selection', HTMLSelectElement>> {
    return {
        selection: selectionAt('timeline-selection'),
        phase: selectionAt('timeline-phase'),
        sample: selectionAt('timeline-sample'),
        clock: selectionAt('timeline-clock')
    };
}
function replaceTimelineFilters(
    events: readonly BenchmarkTimelineEvent[],
    sample: HTMLSelectElement,
    clock: HTMLSelectElement
): void {
    const samples = new Set(events.map(function sampleIndex(observation) {
        return observation.sample;
    }));
    const clocks = new Set(events.map(function eventClock(observation) {
        return observation.clockDomain;
    }));
    sample.replaceChildren(new Option('All', 'all'));
    clock.replaceChildren();
    for (const index of samples) {
        sample.add(new Option(String(index), String(index)));
    }
    for (const domain of clocks) {
        clock.add(new Option(domain, domain));
    }
}
function listenSelections(selections: readonly HTMLSelectElement[], refresh: () => void): void {
    for (const selection of selections) {
        selection.addEventListener('change', refresh);
    }
}
function connectTimelineSelection(data: BenchmarkHtmlChartData): void {
    const { selection, phase, sample, clock } = timelineSelections();
    const chart = chartAt('timeline-chart');
    for (const [ index, timeline ] of data.timelines.entries()) {
        selection.add(new Option(timeline.label, String(index)));
    }
    function phaseEvents(): readonly BenchmarkTimelineEvent[] {
        return (data.timelines[Number(selection.value)]?.events ?? []).filter(function selectedPhase(observation) {
            return phase.value === 'all' || observation.phase === phase.value;
        });
    }
    function refreshChart(): void {
        const events = phaseEvents().filter(function selectedEvent(observation) {
            return (sample.value === 'all' || String(observation.sample) === sample.value) &&
                observation.clockDomain === clock.value;
        });
        renderTimeline(chart, events, clock.value);
    }
    function refreshFilters(): void {
        const events = phaseEvents();
        replaceTimelineFilters(events, sample, clock);
        refreshChart();
    }
    listenSelections([ selection, phase ], refreshFilters);
    listenSelections([ sample, clock ], refreshChart);
    refreshFilters();
}
function renderBenchmarkCharts(data: BenchmarkHtmlChartData): void {
    connectWorkloadSelection(data, {
        distribution: chartAt('distribution'),
        box: chartAt('box'),
        workloads: chartAt('workloads'),
        budgets: chartAt('budgets')
    });
    connectBaselineSelection(data);
    connectTimelineSelection(data);
}
Object.assign(globalThis, { renderBenchmarkCharts });
