import { suite, test } from '../packages/test/test.entry-point.ts';
import { observationVariance } from './statistical-primitives.ts';
import { resolveBenchmarkDefinition } from './benchmark-definition-resolution.ts';
import { normalizeMetricBudget } from './benchmark-budget-definition.ts';
import { createMetricObservations, normalizeBenchmarkMetrics, observationSummary } from './benchmark-observations.ts';
import { availableMetric, unavailableMetric } from './metric-reading.ts';
import { measurementStrategy, wallClockMeasurement } from './measurement-strategy.ts';
import { defaultSamplingPolicy } from './sampling-policy.ts';
import { workload } from './workload.ts';
import type { MetricCollector } from './measurement-types.ts';

const provenance = { collector: 'custom', scope: 'custom' as const, unit: 'bytes' };
const options = { annotations: {}, controls: {}, sampling: defaultSamplingPolicy };
const definition = {
    kind: 'memory' as const,
    workloads: [ workload('one', {}) ],
    measurement: wallClockMeasurement(),
    diagnosticMetrics: [],
    budgets: { one: { value: { maximum: 2 } } }
};

export const testNode = suite('measurement contracts', [
    test('rejects variance overflow instead of returning a non-finite interval', function (scope) {
        scope.assert.throws(function () {
            return observationVariance([ Number.MAX_VALUE, -Number.MAX_VALUE ]);
        }, { message: 'Statistic sampleVariance did not produce a finite value.' });
        return scope.assert.collect();
    }),
    test('rejects workloads without a unique budget assignment', function (scope) {
        const invalid = [
            { ...definition, workloads: [] },
            { ...definition, workloads: [ workload('one', {}), workload('one', {}) ] },
            { ...definition, budgets: {} },
            { ...definition, budgets: { one: {} } },
            { ...definition, budgets: { ...definition.budgets, unknown: { value: { maximum: 2 } } } },
            { ...definition, budgets: { one: { value: [] } } },
            { ...definition, diagnosticMetrics: [ 'value' ] }
        ];
        for (const candidate of invalid) {
            scope.assert.throws(function () {
                return resolveBenchmarkDefinition(candidate, options);
            }, { type: Error });
        }
        return scope.assert.collect();
    }),
    test('normalizes multiple budgets and retains asynchronous strategies', function (scope) {
        const resolved = resolveBenchmarkDefinition({
            ...definition,
            measurement: { mode: 'async', collectors: [] },
            budgets: { one: { value: [ { minimum: 1 }, { maximum: 2 } ] } }
        }, options);
        scope.assert.equal(resolved.measurement.mode, 'async');
        scope.assert.deepEqual(
            (resolved.budgets.get('one') ?? []).map(function threshold(budget) {
                return [ budget.minimum, budget.maximum ];
            }),
            [ [ 1, null ], [ null, 2 ] ]
        );
        return scope.assert.collect();
    }),
    test('rejects empty, reversed, unknown, and invalid statistical bounds', function (scope) {
        for (
            const budget of [
                {},
                { maximum: 2, unrelated: true },
                { minimum: 3, maximum: 2 },
                { maximum: Number.POSITIVE_INFINITY },
                { maximum: 2, statistic: { kind: 'quantile', probability: 0 } },
                { maximum: 2, statistic: { kind: 'quantile', probability: 1 } },
                { maximum: 2, statistic: { kind: 'mean', range: { minimum: 3, maximum: 2 } } },
                { maximum: 2, statistic: { kind: 'mean', range: { minimum: -1e308, maximum: 1e308 } } }
            ]
        ) {
            scope.assert.throws(function () {
                Reflect.apply(normalizeMetricBudget, undefined, [ 'value', budget ]);
            }, { type: Error });
        }
        const mean = normalizeMetricBudget('value', {
            minimum: 0,
            maximum: 2,
            statistic: { kind: 'mean', range: { minimum: 0, maximum: 2 } }
        });
        scope.assert.true(Object.isFrozen(mean.statistic));
        scope.assert.true(mean.statistic.kind === 'mean' && Object.isFrozen(mean.statistic.range));
        return scope.assert.collect();
    }),
    test('rejects collector identity collisions and invalid metric declarations', function (scope) {
        const collector: MetricCollector = {
            name: 'custom',
            mode: 'sync',
            metrics: [],
            prepare() {
                throw new Error('Validation must not prepare collectors.');
            }
        };
        for (
            const collectors of [
                [ { ...collector, name: '' } ],
                [ collector, collector ],
                [ { ...collector, metrics: [ { ...provenance, name: '' } ] } ],
                [ { ...collector, metrics: [ { ...provenance, name: 'value', unit: '' } ] } ],
                [ { ...collector, metrics: [ { ...provenance, name: 'durationMicroseconds' } ] } ],
                [ { ...collector, metrics: [ { ...provenance, name: 'value' }, { ...provenance, name: 'value' } ] } ]
            ]
        ) {
            scope.assert.throws(function () {
                return measurementStrategy(collectors);
            }, { type: TypeError });
        }
        return scope.assert.collect();
    }),
    test('retains unavailable evidence and rejects provenance changes', function (scope) {
        const observations = createMetricObservations();
        scope.assert.throws(function () {
            return observationSummary(observations);
        }, { type: TypeError });
        observations.append(unavailableMetric('unsupported', provenance));
        observations.append(unavailableMetric('unsupported', provenance));
        scope.assert.deepEqual(observationSummary(observations), {
            count: 0,
            minimum: null,
            maximum: null,
            mean: null,
            median: null,
            provenance,
            unavailableReasons: [ 'unsupported' ]
        });
        return scope.assert.collect();
    }),
    test('summarizes zero readings and rejects provenance changes before appending', function (scope) {
        const observations = createMetricObservations();
        observations.append(availableMetric(0, provenance));
        observations.append(availableMetric(0, provenance));
        const summary = observationSummary(observations);
        scope.assert.equal(summary.mean, 0);
        scope.assert.equal(summary.median, 0);
        scope.assert.equal(summary.count, 2);
        scope.assert.throws(function () {
            observations.append(availableMetric(1, { ...provenance, unit: 'count' }));
        }, { message: 'Metric changed unit or provenance between samples.' });
        scope.assert.equal(observations.readings().length, 2);
        return scope.assert.collect();
    }),
    test('normalizes finite custom values and validates explicit readings', function (scope) {
        scope.assert.deepEqual(normalizeBenchmarkMetrics({ value: 3 }), {
            value: {
                availability: 'available',
                value: 3,
                provenance: { collector: 'measure-return', scope: 'custom', unit: 'number' }
            }
        });
        const reading = unavailableMetric('not supported', provenance);
        scope.assert.deepEqual(normalizeBenchmarkMetrics({ value: reading }), { value: reading });
        for (const metrics of [ { value: Number.NaN }, { value: Number.POSITIVE_INFINITY }, { '': 3 } ]) {
            scope.assert.throws(function () {
                return normalizeBenchmarkMetrics(metrics);
            }, { type: Error });
        }
        scope.assert.throws(function () {
            return availableMetric(Number.NaN, provenance);
        }, { type: TypeError });
        return scope.assert.collect();
    })
]);
