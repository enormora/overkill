import { runCpuCalibrationWorkload } from '../packages/run/benchmark-calibration.entry-point.ts';
import { defineCalibrationResource } from './calibration-resource.ts';
import type { CalibrationOptions, CalibrationResource } from './calibration-definition.ts';
import { wallClockMeasurement } from './measurement-strategy.ts';
import { workload } from './workload.ts';

function createCpuCalibration(configuration: readonly [] | readonly [CalibrationOptions]): CalibrationResource {
    return defineCalibrationResource({
        workload: workload('integer-mix', { iterations: 2_000_000 }),
        version: '1',
        unit: 'microseconds',
        dependencies: {},
        measurement: wallClockMeasurement(),
        measure({ sample }) {
            const expected = runCpuCalibrationWorkload();
            const measured = sample.measure(runCpuCalibrationWorkload);
            if (measured.value !== expected) {
                throw new TypeError('CPU calibration checksum changed.');
            }
            return measured.metrics.durationMicroseconds;
        }
    }, ...configuration);
}
const defaultCpuCalibration = createCpuCalibration([]);
export function cpuCalibration(...configuration: readonly [] | readonly [CalibrationOptions]): CalibrationResource {
    return configuration.length === 0 ? defaultCpuCalibration : createCpuCalibration(configuration);
}
