import type { WorkloadParameters } from '../engine/workload-parameters.ts';
import type { BenchmarkDefinitionSummary, BenchmarkLifecyclePolicy } from '../engine/benchmark-result.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';
import {
    resolveCalibratedMeasurement,
    type ResolvedMeasurement
} from './calibrated-measurement.ts';
import type { BenchmarkDefinition, BenchmarkOptions } from './benchmark-definition.ts';
import {
    normalizeMetricBudget,
    type MetricBudget,
    type NormalizedMetricBudget
} from './benchmark-budget-definition.ts';
import { workload } from './workload.ts';
import { validateSamplingPolicy } from './sampling-policy.ts';
import { resolveBenchmarkLifecyclePolicy } from './benchmark-lifecycle-policy.ts';
import { processMeasurement } from './process-measurement.ts';

type BenchmarkCore = Pick<
    BenchmarkDefinition<WorkloadParameters>,
    'budgets' | 'diagnosticMetrics' | 'kind' | 'workloads'
>;
type MeasurementDefinition = { readonly measurement: UncalibratedMeasurement; };
type BenchmarkDefinitionData = BenchmarkCore & MeasurementDefinition;
export type ResolvedBenchmarkDefinition = {
    readonly lifecycle: BenchmarkLifecyclePolicy;
    readonly summary: BenchmarkDefinitionSummary;
    readonly measurement: UncalibratedMeasurement;
    readonly normalization: ResolvedMeasurement['normalization'];
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
    if (measurement.mode === 'process') {
        return processMeasurement(measurement);
    }
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

function validateNormalizedMetrics(
    definition: BenchmarkDefinitionData,
    normalization: ResolvedMeasurement['normalization']
): void {
    const declared = new Set([
        ...definition.diagnosticMetrics,
        ...Object.values(definition.budgets).flatMap(Object.keys)
    ]);
    if (
        Object.keys(normalization).some(function undeclaredMetric(name) {
            return !declared.has(name);
        })
    ) {
        throw new TypeError('Normalization references an undeclared metric.');
    }
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
    const { normalization, measurement } = resolveCalibratedMeasurement(
        definition.measurement,
        new Set([
            ...definition.diagnosticMetrics,
            ...Object.values(definition.budgets).flatMap(Object.keys)
        ])
    );
    validateNormalizedMetrics(definition, normalization);
    const budgets = resolveBudgets(definition, names);

    const summary = Object.freeze({
        normalization: Object.freeze(
            Object.fromEntries(
                Object
                    .entries(normalization)
                    .map(function normalizationSummary([ name, rule ]) {
                        return [ name, {
                            calibration: rule.calibration.calibration,
                            scaling: rule.scaling,
                            garbageCollection: rule.calibration.garbageCollection
                        } ];
                    })
            )
        ),
        lifecycle: resolveBenchmarkLifecyclePolicy(options.lifecycle),
        kind: definition.kind,
        workloads: Object.freeze(workloads.map(function workloadSummary(work) {
            return Object.freeze({ name: work.name, parameters: work.parameters });
        })),
        measurement: measurementSummary(measurement),
        diagnostics: Object.freeze(Array.from(definition.diagnosticMetrics)),
        budgets: Object.freeze(Object.fromEntries(budgets)),
        policy: validateSamplingPolicy(options.sampling)
    });
    return { summary, measurement, budgets, lifecycle: summary.lifecycle, normalization };
}
