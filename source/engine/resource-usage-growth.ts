import type { ResourceUsageSnapshot } from './run-result.ts';

const millisecondsPerSecond = 1000;

export function observedGrowthBytesPerSecond(
    sample: ResourceUsageSnapshot,
    previousSample: ResourceUsageSnapshot | null
): number {
    if (previousSample === null) {
        return 0;
    }

    const elapsedMilliseconds = sample.capturedAtMilliseconds - previousSample.capturedAtMilliseconds;

    if (elapsedMilliseconds <= 0) {
        return 0;
    }

    return Math.max(
        0,
        (sample.residentSetBytes - previousSample.residentSetBytes) * millisecondsPerSecond / elapsedMilliseconds
    );
}
