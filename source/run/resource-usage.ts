import { getHeapStatistics } from 'node:v8';
import type { WallClock } from '@enormora/wall-clock';
import type {
    ResourceUsageSnapshot,
    RunResourceUsage,
    RunResourceUsageTracker
} from '../engine/run-result.ts';

const millisecondsPerSecond = 1000;

type ResourceUsageSample = ResourceUsageSnapshot;

type ResourceUsageTrackerDependencies = {
    readonly readActiveResourceTypes: () => readonly string[];
    readonly readJavaScriptEngineHeapBytes: () => number;
    readonly readResidentSetBytes: () => number;
    readonly wallClock: WallClock;
};

export type ResourceUsageTrackerOptions = {
    readonly samplingIntervalMilliseconds: number;
};

function sortedUnique(values: readonly string[]): readonly string[] {
    return Array.from(new Set(values)).toSorted(function compareText(firstValue, secondValue) {
        return firstValue.localeCompare(secondValue);
    });
}

function readResourceUsageSample(dependencies: ResourceUsageTrackerDependencies): ResourceUsageSample {
    const activeResourceTypes = dependencies.readActiveResourceTypes();

    return {
        activeResourceCount: activeResourceTypes.length,
        activeResourceTypes: sortedUnique(activeResourceTypes),
        capturedAtMilliseconds: dependencies.wallClock.currentTimestampInMilliseconds,
        javaScriptEngineHeapBytes: dependencies.readJavaScriptEngineHeapBytes(),
        residentSetBytes: dependencies.readResidentSetBytes()
    };
}

function maximumSampleValue(
    samples: readonly ResourceUsageSample[],
    readValue: (sample: ResourceUsageSample) => number
): number {
    return Math.max(...samples.map(readValue));
}

function residentSetGrowthBytesPerSecond(
    previousSample: ResourceUsageSample,
    nextSample: ResourceUsageSample
): number {
    const elapsedMilliseconds = nextSample.capturedAtMilliseconds - previousSample.capturedAtMilliseconds;

    if (elapsedMilliseconds <= 0) {
        return 0;
    }

    const residentSetGrowthBytes = nextSample.residentSetBytes - previousSample.residentSetBytes;

    return Math.max(0, residentSetGrowthBytes * millisecondsPerSecond / elapsedMilliseconds);
}

function peakResidentSetGrowthBytesPerSecond(samples: readonly ResourceUsageSample[]): number {
    let peakGrowthBytesPerSecond = 0;

    for (let sampleIndex = 1; sampleIndex < samples.length; sampleIndex += 1) {
        const previousSample = samples[sampleIndex - 1];
        const nextSample = samples[sampleIndex];

        if (previousSample !== undefined && nextSample !== undefined) {
            peakGrowthBytesPerSecond = Math.max(
                peakGrowthBytesPerSecond,
                residentSetGrowthBytesPerSecond(previousSample, nextSample)
            );
        }
    }

    return peakGrowthBytesPerSecond;
}

function createResourceUsage(
    start: ResourceUsageSnapshot,
    end: ResourceUsageSnapshot,
    samples: readonly ResourceUsageSample[]
): RunResourceUsage {
    return {
        activeResourceTypes: sortedUnique(samples.flatMap(function toActiveResourceTypes(sample) {
            return sample.activeResourceTypes;
        })),
        end,
        peakActiveResourceCount: maximumSampleValue(
            samples,
            function readActiveResourceCount(sample) {
                return sample.activeResourceCount;
            }
        ),
        peakJavaScriptEngineHeapBytes: maximumSampleValue(
            samples,
            function readJavaScriptEngineHeapBytes(sample) {
                return sample.javaScriptEngineHeapBytes;
            }
        ),
        peakResidentSetBytes: maximumSampleValue(
            samples,
            function readResidentSetBytes(sample) {
                return sample.residentSetBytes;
            }
        ),
        peakResidentSetGrowthBytesPerSecond: peakResidentSetGrowthBytesPerSecond(samples),
        sampleCount: samples.length,
        start
    };
}

export function createResourceUsageTracker(
    dependencies: ResourceUsageTrackerDependencies,
    options: ResourceUsageTrackerOptions
): RunResourceUsageTracker {
    let intervalIdentifier: ReturnType<typeof globalThis.setInterval> | null = null;
    let samples: readonly ResourceUsageSample[] = [];
    let startSnapshot: ResourceUsageSnapshot | null = null;

    return {
        finish() {
            if (startSnapshot === null) {
                throw new Error('Resource usage tracking must start before it can finish.');
            }

            if (intervalIdentifier !== null) {
                dependencies.wallClock.clearInterval(intervalIdentifier);
                intervalIdentifier = null;
            }

            const endSnapshot = readResourceUsageSample(dependencies);
            samples = [ ...samples, endSnapshot ];

            return createResourceUsage(startSnapshot, endSnapshot, samples);
        },
        start(onSample) {
            if (startSnapshot !== null) {
                throw new Error('Resource usage tracking already started.');
            }

            startSnapshot = readResourceUsageSample(dependencies);
            samples = [ startSnapshot ];
            onSample?.(startSnapshot);
            intervalIdentifier = dependencies.wallClock.setInterval(function collectResourceUsageSample() {
                const sample = readResourceUsageSample(dependencies);
                samples = [ ...samples, sample ];
                onSample?.(sample);
            }, options.samplingIntervalMilliseconds);
        }
    };
}

export function createNodeResourceUsageTracker(
    wallClock: WallClock,
    options: ResourceUsageTrackerOptions
): RunResourceUsageTracker {
    return createResourceUsageTracker({
        readActiveResourceTypes() {
            return process.getActiveResourcesInfo();
        },
        readJavaScriptEngineHeapBytes() {
            return getHeapStatistics().used_heap_size;
        },
        readResidentSetBytes() {
            return process.memoryUsage.rss();
        },
        wallClock
    }, options);
}
