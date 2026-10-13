import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { BenchmarkExecutionResult, BenchmarkBudgetResult } from '../engine/benchmark-result.ts';
import {
    attachmentsForProducer,
    currentAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import { observationSummary, type MetricObservations } from './benchmark-observations.ts';

type SamplingSnapshot = {
    readonly samples: number;
    readonly budgets: readonly BenchmarkBudgetResult[];
    readonly status: BenchmarkExecutionResult['status'];
};

export function summarizedSamplingResult(
    input: SamplingSessionInput,
    observations: ReadonlyMap<string, MetricObservations>,
    snapshot: SamplingSnapshot
): BenchmarkExecutionResult {
    return {
        ...snapshot,
        workload: input.scope.workload,
        policy: input.policy,
        assumption: 'independent-stationary-observations',
        metrics: Object.fromEntries(
            Array.from(observations).flatMap(function metricSummary([ name, metric ]) {
                return metric.readings().length === 0 ? [] : [ [ name, observationSummary(metric) ] ];
            })
        ),
        rawSamples: { status: 'omitted', reference: null, reason: 'Raw observations have not been persisted.' }
    };
}

export async function recordRawSamples(
    result: BenchmarkExecutionResult,
    observations: ReadonlyMap<string, MetricObservations>
): Promise<BenchmarkExecutionResult> {
    if (currentAttachmentLimits() === null) {
        return {
            ...result,
            rawSamples: { status: 'omitted', reference: null, reason: 'No runner attachment coordinator is active.' }
        };
    }

    const artifact = await attachmentsForProducer({ kind: 'case' }).json(
        { name: 'benchmark-samples', mediaType: 'application/json' },
        Object
            .fromEntries(Array.from(observations, function rawMetric([ name, metric ]) {
                return [ name, metric.readings() ];
            }))
    );
    const omitted = artifact.payload.content.kind === 'omitted';
    return {
        ...result,
        rawSamples: {
            status: omitted ? 'omitted' : 'recorded',
            reference: JSON.stringify(artifact.id),
            reason: omitted
                ? artifact
                    .payload
                    .content
                    .reason
                : null
        }
    };
}

export function generatedBudgetAssertions(
    results: readonly BenchmarkBudgetResult[],
    input: SamplingSessionInput
): AssertionResult {
    const checks = results.map(function budgetAssertion(budget) {
        return {
            actual: budget.decision === 'pass' || budget.decision === 'undecided',
            check: 'true' as const,
            message: `${input.workload.name}: ${budget.metric} ${budget.statistic.kind} budget [${
                budget.minimum ?? '-unbounded'
            }, ${budget.maximum ?? 'unbounded'}]: ${budget.decision}; estimate ${budget.estimate}, interval [${
                budget.interval.lower ?? '-unbounded'
            }, ${budget.interval.upper ?? 'unbounded'}].`,
            source: 'assert' as const,
            sourceLocations: input.locations
        };
    });
    const first = checks[0];
    if (first === undefined) {
        throw new TypeError('Benchmark requires generated budget assertions.');
    }
    return [ first, ...checks.slice(1) ];
}
