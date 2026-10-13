import type { MetricProvenance, MetricReading } from '../engine/benchmark-result.ts';

export function availableMetric(value: number, provenance: MetricProvenance): MetricReading {
    if (!Number.isFinite(value)) {
        throw new TypeError(`Metric from ${provenance.collector} must be finite.`);
    }

    return {
        availability: 'available',
        provenance: { collector: provenance.collector, scope: provenance.scope, unit: provenance.unit },
        value
    };
}

export function unavailableMetric(reason: string, provenance: MetricProvenance): MetricReading {
    return {
        availability: 'unavailable',
        provenance: { collector: provenance.collector, scope: provenance.scope, unit: provenance.unit },
        reason
    };
}
