import { createWallClock } from '@enormora/wall-clock';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import type { RuntimeCapabilityPolicyEnvironment } from '../run/capability-policy.ts';
import { defaultRunEngine } from '../run/default-run-engine.ts';
import { createRunOrchestrator } from '../run/run.ts';
import type { RunOrchestrator } from '../run/run-types.ts';
import { createTestEngine } from './create-test-engine.ts';

const deterministicSeed = 99n;

export function createDeterministicRunOrchestrator(): RunOrchestrator {
    const engine = createTestEngine();
    const wallClock = createWallClock();
    const environment: RuntimeCapabilityPolicyEnvironment = {};
    const reporterDispatcher = {
        async disposeReporters() {
            return [];
        },
        async reportEvent() {
            return [];
        },
        async reportResult() {
            return [];
        }
    };

    return createRunOrchestrator({
        createResourceUsageTracker(): RunResourceUsageTracker {
            return {
                finish() {
                    return {
                        activeResourceTypes: [],
                        end: {
                            activeResourceCount: 0,
                            activeResourceTypes: [],
                            capturedAtMilliseconds: 1,
                            javaScriptEngineHeapBytes: 2,
                            residentSetBytes: 3
                        },
                        peakActiveResourceCount: 0,
                        peakJavaScriptEngineHeapBytes: 2,
                        peakResidentSetBytes: 3,
                        peakResidentSetGrowthBytesPerSecond: 0,
                        sampleCount: 2,
                        start: {
                            activeResourceCount: 0,
                            activeResourceTypes: [],
                            capturedAtMilliseconds: 0,
                            javaScriptEngineHeapBytes: 1,
                            residentSetBytes: 2
                        }
                    };
                },
                start() {
                    return undefined;
                }
            };
        },
        createSeed() {
            return deterministicSeed;
        },
        defaultEngine: defaultRunEngine,
        execute: engine.execute,
        runtimeCapabilityPolicy: {
            readEnvironment() {
                return environment;
            },
            readStorage() {
                return null;
            }
        },
        node: {
            arch: 'x64',
            platform: 'linux',
            version: '26.1.1'
        },
        reporterDispatcher,
        readStartedAt() {
            return '2026-07-15T12:30:00.000Z';
        },
        wallClock
    });
}
