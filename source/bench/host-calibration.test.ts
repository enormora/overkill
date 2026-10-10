import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    calibrateBenchmarkHost,
    normalizeBenchmarkDuration,
    type ComparableCalibration
} from '../packages/run/benchmark-calibration.entry-point.ts';

function referenceCalibration(machineClass: string, medianMicroseconds: number): ComparableCalibration {
    return {
        kind: 'comparable',
        machineClass,
        metadata: {},
        context: {
            checksum: 42,
            iterations: 2_000_000,
            medianMicroseconds,
            samplesMicroseconds: Array.from({ length: 7 }, function () {
                return medianMicroseconds;
            }),
            workload: 'integer-mix-v1'
        }
    };
}

export const testNode = suite('benchmark calibration', [
    test('records real reference samples and stable machine attribution', function (scope: TestScope) {
        const first = calibrateBenchmarkHost();
        const second = calibrateBenchmarkHost();
        if (first.kind !== 'comparable' || second.kind !== 'comparable') {
            throw new Error('Reference calibration was not comparable.');
        }
        scope.assert.equal(first.machineClass, second.machineClass);
        scope.assert.notEqual(first.context, null);
        scope.assert.equal(
            normalizeBenchmarkDuration({
                actualCalibration: first,
                baselineCalibration: first,
                durationMicroseconds: 123
            }),
            123
        );
        return scope.assert.collect();
    }),
    test('normalizes durations only through explicit matching-class calibration', function (scope: TestScope) {
        const actualCalibration = referenceCalibration('cpu-a', 200);
        const baselineCalibration = referenceCalibration('cpu-a', 100);
        scope.assert.equal(
            normalizeBenchmarkDuration({ actualCalibration, baselineCalibration, durationMicroseconds: 50 }),
            25
        );
        scope.assert.throws(
            function () {
                return normalizeBenchmarkDuration({
                    actualCalibration,
                    baselineCalibration: referenceCalibration('cpu-b', 100),
                    durationMicroseconds: 50
                });
            },
            { message: 'Benchmark durations cannot be normalized across machine classes.' }
        );
        scope.assert.throws(
            function () {
                return normalizeBenchmarkDuration({
                    actualCalibration,
                    baselineCalibration: { ...baselineCalibration, context: {} },
                    durationMicroseconds: 50
                });
            },
            { name: 'ZodError' }
        );
        scope.assert.throws(
            function () {
                return normalizeBenchmarkDuration({ actualCalibration, baselineCalibration, durationMicroseconds: -1 });
            },
            { message: 'Benchmark duration must be a finite, nonnegative number.' }
        );
        return scope.assert.collect();
    })
]);
