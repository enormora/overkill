import type { ProcessUsageSnapshot } from './process-usage.ts';

const microsecondsPerSecond = 1_000_000;

export function observedGrowthBytesPerSecond(
    sample: ProcessUsageSnapshot,
    previousSample: ProcessUsageSnapshot | null
): number {
    if (previousSample === null) {
        return 0;
    }

    const elapsedMicroseconds = sample.capturedAtMicroseconds - previousSample.capturedAtMicroseconds;

    if (elapsedMicroseconds <= 0) {
        return 0;
    }

    return Math.max(
        0,
        (sample.residentSetBytes - previousSample.residentSetBytes) * microsecondsPerSecond / elapsedMicroseconds
    );
}
