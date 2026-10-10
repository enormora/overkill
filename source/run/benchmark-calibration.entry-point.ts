import { calibrateBenchmarkHost } from '../packages/run/benchmark-calibration.entry-point.ts';

process.stdout.write(JSON.stringify(calibrateBenchmarkHost()));
