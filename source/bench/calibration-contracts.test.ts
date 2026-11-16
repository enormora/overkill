import {
    benchmark,
    processMeasurement,
    availableMetric,
    unavailableMetric,
    calibratedMeasurement,
    rawMeasurement,
    defineCalibrationResource,
    wallClockMeasurement,
    workload,
    type CalibrationDefinition,
    type MeasurementStrategy,
    type MetricNormalization
} from '../packages/bench/bench.entry-point.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { calibrationSnapshot } from '../test-support/calibration-fixture.ts';
import { createCalibrationObservations, type CalibrationObservations } from './calibration-observations.ts';
import { attachCalibrationResources } from './calibration-resource-body.ts';

type ReferenceDefinition = CalibrationDefinition<Readonly<Record<string, never>>, MeasurementStrategy>;
const provenance = { collector: 'reference', scope: 'custom', unit: 'ticks' } as const;
function referenceDefinition(version: string, unit: string): ReferenceDefinition {
    return {
        workload: workload('reference', {}),
        version,
        unit,
        dependencies: {},
        measurement: wallClockMeasurement(),
        measure() {
            return availableMetric(200, provenance);
        }
    };
}
function observeValues(observations: CalibrationObservations, values: readonly number[]): readonly boolean[] {
    return values.map(function checkpointReading(value) {
        observations.observe({ reference: availableMetric(value, provenance) });
        return observations.checkpoint();
    });
}
const invalidObservations = [
    { name: 'missing readings', returned: {} },
    { name: 'unavailable readings', returned: { reference: unavailableMetric('offline', provenance) } },
    { name: 'different units', returned: { reference: availableMetric(200, { ...provenance, unit: 'other' }) } },
    { name: 'zero readings', returned: { reference: availableMetric(0, provenance) } },
    { name: 'negative readings', returned: { reference: availableMetric(-1, provenance) } }
];
const benchmarkDefinition = {
    kind: 'runtime' as const,
    workloads: [ workload('one', {}) ],
    measure() {
        return { value: 100 };
    },
    diagnosticMetrics: [],
    budgets: { one: { value: { maximum: 200 } } }
};
export const testNode = suite('calibration contracts', [
    test('rejects repeated raw measurement wrappers', function (scope: TestScope) {
        scope.assert.throws(function () {
            return rawMeasurement(rawMeasurement(wallClockMeasurement()));
        }, { message: 'Raw measurement requires an uncalibrated strategy.' });
        return scope.assert.collect();
    }),
    test('rejects normalization rules for undeclared benchmark metrics', function (scope: TestScope) {
        const calibration = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        scope.assert.throws(function () {
            benchmark('undeclared metric', {
                ...benchmarkDefinition,
                measurement: calibratedMeasurement(wallClockMeasurement(), {
                    other: { calibration, scaling: 'proportional' }
                })
            });
        }, { message: 'Normalization references an undeclared metric.' });
        return scope.assert.collect();
    }),
    test('preserves process strategies in calibrated benchmark definitions', function (scope: TestScope) {
        const calibration = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        const node = benchmark('normalized process metric', {
            ...benchmarkDefinition,
            measurement: calibratedMeasurement(processMeasurement({ instrumentation: 'off' }), {
                value: { calibration, scaling: 'proportional' }
            })
        });
        const { execution } = node;
        if (execution.kind !== 'body' || execution.bodyMode !== 'benchmark') {
            throw new Error('Expected benchmark execution.');
        }
        scope.assert.equal(execution.definition.measurement.mode, 'process');
        scope.assert.equal(execution.definition.normalization.value?.scaling, 'proportional');
        return scope.assert.collect();
    }),
    ...invalidObservations.map(function invalidObservationCase(input) {
        return test(`rejects ${input.name} without retaining invalid samples`, function (scope: TestScope) {
            const observations = createCalibrationObservations(calibrationSnapshot([ 200, 200 ]));
            scope.assert.throws(function () {
                observations.observe(input.returned);
            }, {
                message: 'Calibration must return an available, positive reading in its declared unit.'
            });
            scope.assert.deepEqual(observations.samples(), []);
            return scope.assert.collect();
        });
    }),
    test('rejects changing provenance while retaining earlier samples', function (scope: TestScope) {
        const observations = createCalibrationObservations(calibrationSnapshot([ 200, 200 ]));
        observations.observe({ reference: availableMetric(200, provenance) });
        scope.assert.throws(function () {
            observations.observe({
                reference: availableMetric(200, { ...provenance, collector: 'other' })
            });
        }, { message: 'Calibration changed its metric provenance between samples.' });
        scope.assert.deepEqual(observations.samples(), [ 200 ]);
        return scope.assert.collect();
    }),
    test('retains scarce samples as non-comparable when precision is unresolved', function (scope: TestScope) {
        const observations = createCalibrationObservations(calibrationSnapshot([ 100, 400 ]));
        scope.assert.deepEqual(observeValues(observations, [ 100, 400 ]), [ false, false ]);
        scope.assert.deepEqual(observations.result(), {
            kind: 'non-comparable',
            reason: 'Calibration sampling limit reached before reference precision.',
            samples: [ 100, 400 ]
        });
        return scope.assert.collect();
    }),
    test('doubles checkpoints until later samples resolve reference precision', function (scope: TestScope) {
        const samples = Array.from({ length: 64 }, function referenceSample(_value, index) {
            if (index >= 24) {
                return 200;
            }
            return index % 2 === 0 ? 100 : 400;
        });
        const definition = calibrationSnapshot(samples);
        const observations = createCalibrationObservations({
            ...definition,
            sampling: { ...definition.sampling, minimumSamples: 16, relativePrecision: 0.001 }
        });
        scope.assert.deepEqual(
            observeValues(observations, samples).flatMap(function preciseCheckpoint(precise, index) {
                return precise ? [ index ] : [];
            }),
            [ 63 ]
        );
        const result = observations.result();
        scope.assert.equal(result.kind, 'comparable');
        if (result.kind === 'comparable') {
            scope.assert.equal(result.snapshot.checkpoint, 3);
            scope.assert.deepEqual(result.snapshot.samples, samples);
        }
        return scope.assert.collect();
    }),
    ...[ 149, 150 ].map(function absolutePrecisionCase(tolerance) {
        return test(`uses absolute reference precision of ${tolerance}`, function (scope: TestScope) {
            const samples = Array.from({ length: 16 }, function (_value, index) {
                return index % 2 === 0 ? 100 : 400;
            });
            const definition = calibrationSnapshot(samples);
            const observations = createCalibrationObservations({
                ...definition,
                sampling: { ...definition.sampling, relativePrecision: 0, absolutePrecision: { reference: tolerance } }
            });
            const checkpoints = observeValues(observations, samples);
            scope.assert.equal(checkpoints.at(-1), tolerance === 150);
            scope.assert.equal(observations.result().kind, tolerance === 150 ? 'comparable' : 'non-comparable');
            return scope.assert.collect();
        });
    }),
    ...[ [ '', 'ticks' ], [ '1', '' ] ].map(function missingIdentityCase([ version, unit ]) {
        return test(`rejects a blank calibration ${version === '' ? 'version' : 'unit'}`, function (scope: TestScope) {
            scope.require.defined(version);
            scope.require.defined(unit);
            scope.assert.throws(function () {
                return defineCalibrationResource(referenceDefinition(version, unit));
            }, {
                message: 'Calibration requires an explicit version and unit.'
            });
            return scope.assert.collect();
        });
    }),
    test('rejects recursively calibrated reference workloads', function (scope: TestScope) {
        const definition = referenceDefinition('1', 'ticks');
        const calibration = defineCalibrationResource(definition);
        const measurement = calibratedMeasurement(wallClockMeasurement(), {
            value: { calibration, scaling: 'proportional' }
        });
        scope.assert.throws(function () {
            return defineCalibrationResource({ ...definition, measurement });
        }, {
            message: 'Calibration requires an explicit version and unit.'
        });
        return scope.assert.collect();
    }),
    test('requires named rules and prevents repeated normalization', function (scope: TestScope) {
        const calibration = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        const rule = { calibration, scaling: 'proportional' } as const;
        const strategy = wallClockMeasurement();
        scope.assert.throws(function () {
            return calibratedMeasurement(strategy, {});
        }, {
            message: 'Calibrated measurement requires metric rules and an uncalibrated strategy.'
        });
        scope.assert.throws(function () {
            return calibratedMeasurement(strategy, { ' ': rule });
        }, {
            message: 'Normalization requires named metrics and proportional or inverse scaling.'
        });
        scope.assert.throws(
            function () {
                return calibratedMeasurement(calibratedMeasurement(strategy, { value: rule }), { value: rule });
            },
            {
                message: 'Calibrated measurement requires metric rules and an uncalibrated strategy.'
            }
        );
        return scope.assert.collect();
    }),
    test('rejects unknown scaling supplied by JavaScript callers', function (scope: TestScope) {
        const calibration = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        scope.assert.throws(function () {
            Reflect.apply(calibratedMeasurement, undefined, [ wallClockMeasurement(), {
                value: { calibration, scaling: 'quadratic' }
            } ]);
        }, { message: 'Normalization requires named metrics and proportional or inverse scaling.' });
        return scope.assert.collect();
    }),
    test('captures metric rules independently of later caller mutations', function (scope: TestScope) {
        const calibration = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        const rules: Record<string, MetricNormalization> = { value: { calibration, scaling: 'proportional' } };
        const measurement = calibratedMeasurement(wallClockMeasurement(), rules);
        rules.value = { calibration, scaling: 'inverse' };
        scope.assert.equal(measurement.normalization.value?.scaling, 'proportional');
        return scope.assert.collect();
    }),
    test('rejects distinct resource definitions sharing one calibration identity', function (scope: TestScope) {
        const first = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        const second = defineCalibrationResource(referenceDefinition('1', 'ticks'));
        scope.assert.throws(function () {
            return attachCalibrationResources(function () {
                return undefined;
            }, {
                first: { calibration: first, scaling: 'proportional' },
                second: { calibration: second, scaling: 'inverse' }
            });
        }, { message: 'Reuse one calibration resource for each workload identity.' });
        return scope.assert.collect();
    })
]);
