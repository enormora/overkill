import type { WorkloadParameters } from '../engine/workload-parameters.ts';
import type { BenchmarkDefinitionSummary } from '../engine/benchmark-result.ts';
import type { BenchmarkDefinition, BenchmarkOptions } from './benchmark-definition.ts';
import {
    normalizeMetricBudget,
    type MetricBudget,
    type NormalizedMetricBudget
} from './benchmark-budget-definition.ts';
import { workload } from './workload.ts';
import { validateSamplingPolicy } from './sampling-policy.ts';
import { asyncMeasurementStrategy, measurementStrategy } from './measurement-strategy.ts';
import type { AsyncMeasurementStrategy, MeasurementStrategy } from './measurement-types.ts';

type BenchmarkCore = Pick<
    BenchmarkDefinition<WorkloadParameters>,
    'budgets' | 'diagnosticMetrics' | 'kind' | 'workloads'
>;
type MeasurementDefinition = { readonly measurement: AsyncMeasurementStrategy | MeasurementStrategy; };
type BenchmarkDefinitionData = BenchmarkCore & MeasurementDefinition;
export type ResolvedBenchmarkDefinition = {
    readonly summary: BenchmarkDefinitionSummary;
    readonly measurement: AsyncMeasurementStrategy | MeasurementStrategy;
    readonly budgets: ReadonlyMap<string, readonly NormalizedMetricBudget[]>;
};

function isBudgetList(budget: MetricBudget | readonly MetricBudget[]): budget is readonly MetricBudget[] {
    return Array.isArray(budget);
}

function metricBudgets(definitions: BenchmarkDefinitionData['budgets'][string]): readonly NormalizedMetricBudget[] {
    return Object.entries(definitions).flatMap(function budgetsForMetric([ metric, budgets ]) {
        const entries = isBudgetList(budgets) ? budgets : [ budgets ];
        if (entries.length === 0) {
            throw new TypeError(`Metric ${metric} requires a budget.`);
        }
        return entries.map(function normalize(budget) {
            return normalizeMetricBudget(metric, budget);
        });
    });
}

function resolveBudgets(
    definition: BenchmarkDefinitionData,
    names: readonly string[]
): ResolvedBenchmarkDefinition['budgets'] {
    if (
        Object.keys(definition.budgets).some(function unknownWorkload(name) {
            return !names.includes(name);
        })
    ) {
        throw new TypeError('Budget references an unknown workload.');
    }

    return new Map(names.map(function validateWorkload(name) {
        const budgets = definition.budgets[name];
        if (budgets === undefined || Object.keys(budgets).length === 0) {
            throw new TypeError(`Workload ${name} requires at least one budget.`);
        }
        const normalized = metricBudgets(budgets);
        if (
            normalized.some(function diagnosticBudget(budget) {
                return definition.diagnosticMetrics.includes(budget.metric);
            })
        ) {
            throw new TypeError('A budgeted metric cannot also be diagnostic.');
        }

        return [ name, Object.freeze(normalized) ];
    }));
}

function measurementSummary(
    measurement: ResolvedBenchmarkDefinition['measurement']
): BenchmarkDefinitionSummary['measurement'] {
    return Object.freeze({
        mode: measurement.mode,
        collectors: Object.freeze(measurement.collectors.map(function collectorDefinition(collector) {
            return Object.freeze({
                name: collector.name,
                metrics: Object.freeze(collector.metrics.map(function declaration(metric) {
                    return Object.freeze({ ...metric });
                }))
            });
        }))
    });
}

export function resolveBenchmarkDefinition(
    definition: BenchmarkDefinitionData,
    options: BenchmarkOptions
): ResolvedBenchmarkDefinition {
    const workloads = Object.freeze(definition.workloads.map(function immutable(work) {
        return workload(work.name, work.parameters);
    }));
    const names = workloads.map(function name(work) {
        return work.name;
    });
    const uniqueNames = new Set(names);
    if (names.length === 0 || uniqueNames.size !== names.length) {
        throw new TypeError('Benchmark requires unique workloads.');
    }
    const measurement = definition.measurement.mode === 'sync'
        ? measurementStrategy(definition.measurement.collectors)
        : asyncMeasurementStrategy(definition.measurement.collectors);
    const budgets = resolveBudgets(definition, names);
    const summary = Object.freeze({
        kind: definition.kind,
        workloads: Object.freeze(workloads.map(function workloadSummary(work) {
            return Object.freeze({ name: work.name, parameters: work.parameters });
        })),
        measurement: measurementSummary(measurement),
        diagnostics: Object.freeze(Array.from(definition.diagnosticMetrics)),
        budgets: Object.freeze(Object.fromEntries(budgets)),
        policy: validateSamplingPolicy(options.sampling)
    });
    return { summary, measurement, budgets };
}
