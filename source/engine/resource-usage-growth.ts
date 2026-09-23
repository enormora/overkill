import type { ResourceUsageSnapshot } from './run-result.ts';

const microsecondsPerSecond = 1_000_000;

export function observedGrowthBytesPerSecond(
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
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
