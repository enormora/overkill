import { z } from 'zod/v4';
import type { WorkId } from '../engine/identity.ts';
import { workIdSchema } from '../engine/identity-schema.ts';
import { comparableCalibrationSchema } from '../bench/calibration-schema.ts';
import type {
    ChartedPerformanceBaselineAdapter,
    PerformanceBaselineAdapter,
    PerformanceComparison,
    PerformanceMetricComparison,
    PerformanceProposalInput
} from './performance-adapter.ts';

type ObservedPerformance = PerformanceProposalInput & {
    readonly kind: 'observed';
    readonly comparison: PerformanceComparison | null;
};
type InapplicablePerformance = { readonly kind: 'not-applicable'; };
type UnevaluatedPerformance = { readonly kind: 'not-evaluated'; readonly reason: string; };
type ErroredPerformance = { readonly kind: 'error'; readonly reason: string; };
type PerformanceObservationStates = {
    readonly error: ErroredPerformance;
    readonly inapplicable: InapplicablePerformance;
    readonly observed: ObservedPerformance;
    readonly unevaluated: UnevaluatedPerformance;
};
export type PerformanceObservationEvidence = PerformanceObservationStates[keyof PerformanceObservationStates];
type AvailablePresentation = { readonly kind: 'available'; readonly metrics: readonly PerformanceMetricComparison[]; };
type UnavailablePresentation = { readonly kind: 'unavailable'; readonly reason: string; };
type ErroredPresentation = { readonly kind: 'error'; readonly reason: string; };
export type PerformancePresentation = AvailablePresentation | ErroredPresentation | UnavailablePresentation;
export type PerformanceBaselineEvidence = {
    readonly adapter: string;
    readonly work: WorkId;
    readonly observation: PerformanceObservationEvidence;
    readonly presentation: PerformancePresentation;
};
const finite = z.number();
const rangeSchema = z
    .strictObject({
        kind: z.literal('range'),
        minimum: finite.nullable(),
        maximum: finite.nullable()
    })
    .refine(function orderedRange(value) {
        return (value.minimum !== null || value.maximum !== null) &&
            (value.minimum === null || value.maximum === null || value.minimum <= value.maximum);
    }, 'Metric ranges require at least one bound and ordered limits.');
const metricSchema: z.ZodType<PerformanceMetricComparison> = z.strictObject({
    name: z.string().min(1),
    unit: z.string().min(1),
    actual: finite.nullable(),
    scale: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('raw') }),
        z.strictObject({ kind: z.literal('normalized'), description: z.string().min(1) })
    ]),
    expected: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('missing') }),
        z.strictObject({ kind: z.literal('value'), value: finite }),
        rangeSchema
    ])
});
const metricsSchema = z.array(metricSchema).refine(function uniqueMetrics(metrics) {
    const keys = metrics.map(function metricKey(metric) {
        return JSON.stringify([ metric.name, metric.scale ]);
    });
    const unique = new Set(keys);
    return unique.size === keys.length;
}, 'Chart metric identities must be unique.');
const baselineValueSchema = z.strictObject({ calibration: comparableCalibrationSchema, value: z.json() });
const diagnosticSchema = z.strictObject({ actual: z.json(), expected: z.json(), summary: z.string() });
const comparisonSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('match') }),
    z.strictObject({ kind: z.literal('mismatch'), diagnostics: z.tuple([ diagnosticSchema ]).rest(diagnosticSchema) })
]);
export const performanceEvidenceSchema: z.ZodType<PerformanceBaselineEvidence> = z.strictObject({
    adapter: z.string().min(1),
    work: workIdSchema,
    observation: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('observed'),
            actual: baselineValueSchema,
            expected: baselineValueSchema.nullable(),
            comparison: comparisonSchema.nullable()
        }),
        z.strictObject({ kind: z.literal('not-applicable') }),
        z.strictObject({ kind: z.literal('not-evaluated'), reason: z.string() }),
        z.strictObject({ kind: z.literal('error'), reason: z.string() })
    ]),
    presentation: z.discriminatedUnion('kind', [
        z.strictObject({ kind: z.literal('available'), metrics: metricsSchema }),
        z.strictObject({ kind: z.literal('unavailable'), reason: z.string() }),
        z.strictObject({ kind: z.literal('error'), reason: z.string() })
    ])
});

function hasMetricPresentation(adapter: PerformanceBaselineAdapter): adapter is ChartedPerformanceBaselineAdapter {
    return typeof Reflect.get(adapter, 'describeMetrics') === 'function';
}
export function presentPerformanceMetrics(
    adapter: PerformanceBaselineAdapter,
    observation: PerformanceObservationEvidence
): PerformancePresentation {
    if (observation.kind !== 'observed' || !hasMetricPresentation(adapter)) {
        return { kind: 'unavailable', reason: 'Chart metadata unavailable.' };
    }
    try {
        return { kind: 'available', metrics: metricsSchema.parse(adapter.describeMetrics(observation)) };
    } catch (error: unknown) {
        return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
    }
}
