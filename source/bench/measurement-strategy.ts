import type {
    AsyncMeasurementStrategy,
    AsyncMetricCollector,
    MeasurementStrategy,
    MetricCollector,
    MetricDeclaration
} from './measurement-types.ts';

function registerMetrics(
    metrics: readonly MetricDeclaration[],
    hasName: (name: string) => boolean,
    register: (name: string) => void
): void {
    for (const metric of metrics) {
        if (metric.name.trim().length === 0 || hasName(metric.name) || metric.unit.trim().length === 0) {
            throw new TypeError('Collector metrics require unique names and explicit units.');
        }
        register(metric.name);
    }
}

function validateCollectors(collectors: readonly (AsyncMetricCollector | MetricCollector)[]): void {
    const names = new Set([ 'durationMicroseconds', 'operationsPerSecond' ]);
    const identities = new Set<string>();

    for (const collector of collectors) {
        if (collector.name.trim().length === 0 || identities.has(collector.name)) {
            throw new TypeError('Collectors require unique non-empty identities.');
        }

        identities.add(collector.name);

        registerMetrics(collector.metrics, function (name) {
            return names.has(name);
        }, function (name) {
            names.add(name);
        });
    }
}

export function measurementStrategy(collectors: readonly MetricCollector[]): MeasurementStrategy {
    validateCollectors(collectors);
    return Object.freeze({ mode: 'sync', collectors: Object.freeze(Array.from(collectors)) });
}

export function asyncMeasurementStrategy(
    collectors: readonly (AsyncMetricCollector | MetricCollector)[]
): AsyncMeasurementStrategy {
    validateCollectors(collectors);
    return Object.freeze({ mode: 'async', collectors: Object.freeze(Array.from(collectors)) });
}

export function wallClockMeasurement(): MeasurementStrategy {
    return measurementStrategy([]);
}
