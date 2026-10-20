import { measurementStrategy, asyncMeasurementStrategy } from './measurement-strategy.ts';
import { processMeasurement } from './process-measurement.ts';
import type { CalibrationResource } from './calibration-definition.ts';

import type { UncalibratedMeasurement } from './measurement-definition.ts';

export type MetricNormalization = {
    readonly calibration: CalibrationResource;
    readonly scaling: 'inverse' | 'proportional';
};
export type CalibratedMeasurement<Strategy extends UncalibratedMeasurement = UncalibratedMeasurement> = Strategy & {
    readonly kind: 'calibrated';
    readonly normalization: Readonly<Record<string, MetricNormalization>>;
};
function isCalibratedMeasurement(strategy: UncalibratedMeasurement): strategy is CalibratedMeasurement {
    return Object.hasOwn(strategy, 'kind');
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
type ResolvedMeasurement = {
    readonly measurement: UncalibratedMeasurement;
    readonly normalization: Readonly<Record<string, MetricNormalization>>;
};
export function resolveCalibratedMeasurement(measurement: UncalibratedMeasurement): ResolvedMeasurement {
    return {
        measurement: resolvedStrategy(measurement),
        normalization: isCalibratedMeasurement(measurement) ? measurement.normalization : {}
    };
}
