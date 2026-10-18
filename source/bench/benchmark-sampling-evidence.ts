import type { AssertionResult } from '../assertion-protocol/assertion-node.ts';
import type { BenchmarkExecutionResult, BenchmarkBudgetResult } from '../engine/benchmark-result.ts';
import {
    attachmentsForProducer,
    currentAttachmentLimits
} from '../packages/resources/attachment-context.entry-point.ts';
import type { SamplingSessionInput } from './benchmark-sampling-types.ts';
import type { MetricObservations } from './benchmark-observations.ts';
import { summarizeObservations } from './benchmark-observation-set.ts';

type BudgetAssertionContext = Pick<SamplingSessionInput, 'locations' | 'workload'>;

type SamplingSnapshot = {
    readonly lifecycle: BenchmarkExecutionResult['lifecycle'];
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
        metrics: summarizeObservations(observations),
        rawSamples: { status: 'omitted', reference: null, reason: 'Raw observations have not been persisted.' }
    };
}

export async function recordObservationSamples(
    name: 'benchmark-samples' | 'benchmark-warmup-samples',
    observations: ReadonlyMap<string, MetricObservations>
): Promise<BenchmarkExecutionResult['rawSamples']> {
    if (currentAttachmentLimits() === null) {
        return { status: 'omitted', reference: null, reason: 'No runner attachment coordinator is active.' };
    }
    const artifact = await attachmentsForProducer({ kind: 'case' }).json(
        { name, mediaType: 'application/json' },
        Object.fromEntries(Array.from(observations, function rawMetric([ metric, readings ]) {
            return [ metric, readings.readings() ];
        }))
    );
    const omitted = artifact.payload.content.kind === 'omitted';
    return {
        status: omitted ? 'omitted' : 'recorded',
        reference: JSON.stringify(artifact.id),
        reason: omitted ? artifact.payload.content.reason : null
    };
}

export async function recordRawSamples(
    result: BenchmarkExecutionResult,
    observations: ReadonlyMap<string, MetricObservations>
): Promise<BenchmarkExecutionResult> {
    return { ...result, rawSamples: await recordObservationSamples('benchmark-samples', observations) };
}

export function generatedBudgetAssertions(
    results: readonly BenchmarkBudgetResult[],
    input: BudgetAssertionContext
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
