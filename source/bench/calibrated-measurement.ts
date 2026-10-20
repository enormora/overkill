import { measurementStrategy, asyncMeasurementStrategy } from './measurement-strategy.ts';
import { defaultMetricNormalization } from './default-normalization.ts';
import { processMeasurement } from './process-measurement.ts';
import type { MetricNormalization } from './calibration-definition.ts';

import type { UncalibratedMeasurement } from './measurement-definition.ts';

export type CalibratedMeasurement<Strategy extends UncalibratedMeasurement = UncalibratedMeasurement> = Strategy & {
    readonly kind: 'calibrated';
    readonly normalization: Readonly<Record<string, MetricNormalization>>;
};
function isCalibratedMeasurement(strategy: UncalibratedMeasurement): strategy is CalibratedMeasurement {
    return Reflect.get(strategy, 'kind') === 'calibrated';
}
export function calibratedMeasurement<Strategy extends UncalibratedMeasurement>(
    strategy: Strategy,
    metrics: Readonly<Record<string, MetricNormalization>>
): CalibratedMeasurement<Strategy> {
    if (Object.keys(metrics).length === 0 || Object.hasOwn(strategy, 'kind')) {
        throw new TypeError('Calibrated measurement requires metric rules and an uncalibrated strategy.');
    }
    const normalization = Object.freeze(
        Object.fromEntries(
            Object
                .entries(metrics)
                .map(function immutableRule([ name, rule ]) {
                    if (name.trim().length === 0 || ![ 'proportional', 'inverse' ].includes(rule.scaling)) {
                        throw new TypeError(
                            'Normalization requires named metrics and proportional or inverse scaling.'
                        );
                    }
                    return [ name, Object.freeze({ ...rule }) ];
                })
        )
    );
    const calibrated = { ...strategy, kind: 'calibrated' as const, normalization };
    Object.freeze(calibrated);
    return calibrated;
}
function resolvedStrategy(measurement: UncalibratedMeasurement): UncalibratedMeasurement {
    if (measurement.mode === 'process') {
        return processMeasurement(measurement);
    }
    return measurement.mode === 'sync'
        ? measurementStrategy(measurement.collectors)
        : asyncMeasurementStrategy(measurement.collectors);
}
export type ResolvedMeasurement = {
    readonly measurement: UncalibratedMeasurement;
    readonly normalization: Readonly<Record<string, MetricNormalization>>;
};
export function rawMeasurement<Strategy extends UncalibratedMeasurement>(
    strategy: Strategy
): Strategy & { readonly kind: 'raw'; } {
    if (Object.hasOwn(strategy, 'kind')) {
        throw new TypeError('Raw measurement requires an uncalibrated strategy.');
    }
    const raw = { ...strategy, kind: 'raw' as const };
    Object.freeze(raw);
    return raw;
}
export function resolveCalibratedMeasurement(
    measurement: UncalibratedMeasurement,
    declared: ReadonlySet<string>
): ResolvedMeasurement {
    if (isCalibratedMeasurement(measurement)) {
        return { measurement: resolvedStrategy(measurement), normalization: measurement.normalization };
    }
    return {
        measurement: resolvedStrategy(measurement),
        normalization: Object.hasOwn(measurement, 'kind') ? {} : defaultMetricNormalization(measurement, declared)
    };
}
