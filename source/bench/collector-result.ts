import type { CollectorResult } from '../engine/measurement-evidence.ts';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import { collectorResultSchema } from './measurement-evidence-schema.ts';
import type { CollectorFinalizationContext, MetricDeclaration, MetricReadings } from './measurement-types.ts';
import { metricReadingSchema } from './benchmark-statistics-schema.ts';
import { MeasurementContractError } from './measurement-contract-error.ts';
import { unavailableMetric } from './metric-reading.ts';
import { attributeReading } from './measurement-attribution.ts';

function declaredReading(result: CollectorResult, metric: MetricDeclaration): MetricReadings[string] {
    const reading = result.completeness.kind === 'incomplete'
        ? unavailableMetric(
            result.completeness.reasons.length === 0
                ? 'Collector evidence is incomplete.'
                : result.completeness.reasons.join('; '),
            metric
        )
        : metricReadingSchema.parse(
            result.readings[metric.name] ?? unavailableMetric('Collector omitted the reading.', metric)
        );
    const expected = { collector: metric.collector, scope: metric.scope, unit: metric.unit };
    if (canonicalIdentityJson(reading.provenance) !== canonicalIdentityJson(expected)) {
        throw new MeasurementContractError('Collector reading changed its declared provenance.', {});
    }
    attributeReading(result.readings[metric.name] ?? reading);
    attributeReading(reading);
    return reading;
}
export function validateCollectorResult(
    result: CollectorResult,
    context: CollectorFinalizationContext,
    metrics: readonly MetricDeclaration[]
): MetricReadings {
    collectorResultSchema.parse(result);
    if (
        canonicalIdentityJson(result.invocation) !== canonicalIdentityJson(context.invocation) ||
        canonicalIdentityJson(result.target) !== canonicalIdentityJson(context.target)
    ) {
        throw new MeasurementContractError('Collector returned evidence for another invocation or target.', {});
    }
    const names = new Set(metrics.map(function metricName(metric) {
        return metric.name;
    }));
    if (
        Object.keys(result.readings).some(function undeclared(name) {
            return !names.has(name);
        })
    ) {
        throw new MeasurementContractError('Collector returned an undeclared metric.', {});
    }
    return Object.fromEntries(metrics.map(function readingEntry(metric) {
        return [ metric.name, declaredReading(result, metric) ];
    }));
}
