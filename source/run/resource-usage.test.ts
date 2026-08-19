import { createDeterministicWallClock } from '@enormora/wall-clock';
import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createResourceUsageTracker } from './resource-usage.ts';

function readSequence(values: readonly number[]): () => number {
    let index = 0;

    return function readNextValue() {
        const value = values[Math.min(index, values.length - 1)];
        index += 1;

        return value ?? 0;
    };
}

export const testSuite = createOverkillSuite({
    name: 'source/run/resource-usage.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'resource usage tracker summarizes sampled memory and start/end active resources',
            metadata: {},
            body(scope: OverkillScope) {
                const wallClock = createDeterministicWallClock();
                let activeResourceReadCount = 0;
                const tracker = createResourceUsageTracker({
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

                tracker.start();
                wallClock.advanceByMilliseconds(100);
                wallClock.advanceByMilliseconds(100);
                const resourceUsage = tracker.finish();

                scope.assert.deepEqual(resourceUsage, {
                    activeResourceTypes: [ 'TCPServerWrap', 'Timeout', 'TTYWrap' ],
                    end: {
                        activeResourceCount: 3,
                        activeResourceTypes: [ 'Timeout', 'TTYWrap' ],
                        capturedAtMilliseconds: 200,
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
                        capturedAtMilliseconds: 0,
                        javaScriptEngineHeapBytes: 10,
                        residentSetBytes: 100
                    }
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
