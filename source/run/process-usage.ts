import { getHeapStatistics } from 'node:v8';
import type { Clock } from '@enormora/clock';
import type { ProcessUsageSnapshot, RunProcessUsage, RunProcessUsageTracker } from '../engine/process-usage.ts';

const microsecondsPerSecond = 1_000_000;

type ProcessUsageSample = ProcessUsageSnapshot;

type ProcessUsageTrackerDependencies = {
    readonly readActiveResourceTypes: () => readonly string[];
    readonly readJavaScriptEngineHeapBytes: () => number;
    readonly readResidentSetBytes: () => number;
    readonly wallClock: Clock;
};

export type ProcessUsageTrackerOptions = {
    readonly samplingIntervalMilliseconds: number;
};

function sortedUnique(values: readonly string[]): readonly string[] {
    return Array.from(new Set(values)).toSorted(function compareText(firstValue, secondValue) {
        return firstValue.localeCompare(secondValue);
    });
}

function readProcessUsageSample(dependencies: ProcessUsageTrackerDependencies): ProcessUsageSample {
    const activeResourceTypes = dependencies.readActiveResourceTypes();

    return {
        activeResourceCount: activeResourceTypes.length,
        activeResourceTypes: sortedUnique(activeResourceTypes),
        capturedAtMicroseconds: Number(dependencies.wallClock.currentMonotonicMicroseconds),
        javaScriptEngineHeapBytes: dependencies.readJavaScriptEngineHeapBytes(),
        residentSetBytes: dependencies.readResidentSetBytes()
    };
}

function maximumSampleValue(
    samples: readonly ProcessUsageSample[],
    readValue: (sample: ProcessUsageSample) => number
): number {
    return Math.max(...samples.map(readValue));
}

function residentSetGrowthBytesPerSecond(
    previousSample: ProcessUsageSample,
    nextSample: ProcessUsageSample
): number {
    const elapsedMicroseconds = nextSample.capturedAtMicroseconds - previousSample.capturedAtMicroseconds;

    if (elapsedMicroseconds <= 0) {
        return 0;
    }

    const residentSetGrowthBytes = nextSample.residentSetBytes - previousSample.residentSetBytes;

    return Math.max(0, residentSetGrowthBytes * microsecondsPerSecond / elapsedMicroseconds);
}

function peakResidentSetGrowthBytesPerSecond(samples: readonly ProcessUsageSample[]): number {
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

export function createProcessUsageFromSamples(
    start: ProcessUsageSnapshot,
    end: ProcessUsageSnapshot,
    samples: readonly ProcessUsageSample[]
): RunProcessUsage {
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

export function createProcessUsageTracker(
    dependencies: ProcessUsageTrackerDependencies,
    options: ProcessUsageTrackerOptions
): RunProcessUsageTracker {
    let intervalIdentifier: ReturnType<Clock['setInterval']> | null = null;
    let samples: readonly ProcessUsageSample[] = [];
    let startSnapshot: ProcessUsageSnapshot | null = null;

    return {
        finish() {
            if (startSnapshot === null) {
                throw new Error('Process usage tracking must start before it can finish.');
            }

            if (intervalIdentifier !== null) {
                dependencies.wallClock.clearInterval(intervalIdentifier);
                intervalIdentifier = null;
            }

            const endSnapshot = readProcessUsageSample(dependencies);
            samples = [ ...samples, endSnapshot ];

            return createProcessUsageFromSamples(startSnapshot, endSnapshot, samples);
        },
        start(onSample) {
            if (startSnapshot !== null) {
                throw new Error('Process usage tracking already started.');
            }

            startSnapshot = readProcessUsageSample(dependencies);
            samples = [ startSnapshot ];
            onSample?.(startSnapshot);
            intervalIdentifier = dependencies.wallClock.setInterval(function collectProcessUsageSample() {
                const sample = readProcessUsageSample(dependencies);
                samples = [ ...samples, sample ];
                onSample?.(sample);
            }, options.samplingIntervalMilliseconds);
        }
    };
}

export function createNodeProcessUsageTracker(
    wallClock: Clock,
    options: ProcessUsageTrackerOptions
): RunProcessUsageTracker {
    return createProcessUsageTracker({
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
