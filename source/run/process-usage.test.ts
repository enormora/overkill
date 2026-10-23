import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { RunProcessUsageTracker } from '../engine/process-usage.ts';
import { createProcessUsageTracker } from './process-usage.ts';

function readSequence(values: readonly number[]): () => number {
    let index = 0;

    return function readNextValue() {
        const value = values[Math.min(index, values.length - 1)];
        index += 1;

        return value ?? 0;
    };
}

function createEmptyProcessUsageTracker(): RunProcessUsageTracker {
    return createProcessUsageTracker({
        readActiveResourceTypes() {
            return [];
        },
        readJavaScriptEngineHeapBytes() {
            return 0;
        },
        readResidentSetBytes() {
            return 0;
        },
        wallClock: createDeterministicClock({ initialUnixEpochMicroseconds: 0n })
    }, {
        samplingIntervalMilliseconds: 100
    });
}

function createChangingProcessUsageTracker(
    wallClock: DeterministicClock
): RunProcessUsageTracker {
    let activeResourceReadCount = 0;

    return createProcessUsageTracker({
        readActiveResourceTypes() {
            activeResourceReadCount += 1;

            if (activeResourceReadCount === 1) {
                return [ 'TCPServerWrap' ];
            }

            return [ 'Timeout', 'Timeout', 'TTYWrap' ];
        },
        readJavaScriptEngineHeapBytes: readSequence([ 10, 20, 15, 16 ]),
        readResidentSetBytes: readSequence([ 100, 130, 210, 205 ]),
        wallClock
    }, {
        samplingIntervalMilliseconds: 100
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/process-usage.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'process usage tracker summarizes sampled memory and start/end active resources',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const wallClock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
                const tracker = createChangingProcessUsageTracker(wallClock);
                const observedActiveResourceCounts: number[] = [];

                tracker.start(function recordSample(processUsageSample) {
                    observedActiveResourceCounts.push(processUsageSample.activeResourceCount);
                });
                for (const milliseconds of [ 100, 100 ]) {
                    wallClock.advanceByMilliseconds(milliseconds);
                }
                const processUsage = tracker.finish();

                scope.assert.deepEqual(processUsage, {
                    activeResourceTypes: [ 'TCPServerWrap', 'Timeout', 'TTYWrap' ],
                    end: {
                        activeResourceCount: 3,
                        activeResourceTypes: [ 'Timeout', 'TTYWrap' ],
                        capturedAtMicroseconds: 200_000,
                        javaScriptEngineHeapBytes: 16,
                        residentSetBytes: 205
                    },
                    peakActiveResourceCount: 3,
                    peakJavaScriptEngineHeapBytes: 20,
                    peakResidentSetBytes: 210,
                    peakResidentSetGrowthBytesPerSecond: 800,
                    sampleCount: 4,
                    start: {
                        activeResourceCount: 1,
                        activeResourceTypes: [ 'TCPServerWrap' ],
                        capturedAtMicroseconds: 0,
                        javaScriptEngineHeapBytes: 10,
                        residentSetBytes: 100
                    }
                });
                scope.assert.deepEqual(observedActiveResourceCounts, [ 1, 3, 3 ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'process usage tracker rejects invalid lifecycle calls',
            annotations: {},
            controls: {},
            body(scope: OverkillScope) {
                const unfinishedTracker = createEmptyProcessUsageTracker();
                const startedTracker = createEmptyProcessUsageTracker();

                startedTracker.start();

                scope.assert.throws(function finishBeforeStart() {
                    unfinishedTracker.finish();
                }, {
                    message: 'Process usage tracking must start before it can finish.'
                });
                scope.assert.throws(function startTwice() {
                    startedTracker.start();
                }, {
                    message: 'Process usage tracking already started.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('#test-runner');

await runTestFileIfMain(import.meta, testNode);
