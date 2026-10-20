import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { UncalibratedMeasurement } from './measurement-definition.ts';
import type { MetricNormalization } from './calibration-definition.ts';
import { processCpuCollector, threadCpuCollector } from './native-metric-collectors.ts';
import { cpuCalibration } from './cpu-calibration.ts';

const timingMetrics = new Map<string, MetricNormalization['scaling']>([
    [ 'durationMicroseconds', 'proportional' ],
    [ 'operationsPerSecond', 'inverse' ]
]);
const cpuMetrics = [ processCpuCollector(), threadCpuCollector() ].flatMap(function cpuDeclarations(collector) {
    return collector.metrics;
});
export function defaultMetricNormalization(
    measurement: UncalibratedMeasurement,
    declared: ReadonlySet<string>
): Readonly<Record<string, MetricNormalization>> {
    const metrics = new Map(timingMetrics);
    const collected = measurement.mode === 'process'
        ? cpuMetrics.filter(function processMetric(metric) {
            return metric.scope === 'process';
        })
        : measurement.collectors.flatMap(function collectorMetrics(collector) {
            return collector.metrics;
        });
    for (const metric of collected) {
        if (
            cpuMetrics.some(function knownCpuMetric(candidate) {
                return canonicalIdentityJson(candidate) === canonicalIdentityJson(metric);
            })
        ) {
            metrics.set(metric.name, 'proportional');
        }
    }
    return Object.fromEntries(
        Array.from(metrics).flatMap(function declaredRule([ name, scaling ]) {
            return declared.has(name) ? [ [ name, { calibration: cpuCalibration(), scaling } ] ] : [];
        })
    );
}
