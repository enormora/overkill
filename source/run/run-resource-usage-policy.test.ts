import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    createRunOrchestrator,
    type RunCommand,
    type RunConfig,
    type RunOrchestrator,
    type RunRequest
} from './run.ts';

const defaultConfig: RunConfig = {
    loader: {
        sourceMaps: false,
        stripMode: 'strip-only'
    },
    outputRenderer: {
        render() {
            return '';
        }
    },
    profiles: {
        microtest: {
            measureResourceUsage: false,
            resourceBudgets: {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            resourceUsageSamplingIntervalMilliseconds: 100
        }
    },
    reporters: [],
    runtimeStateDir: '.overkill'
};

const defaultRequest: RunRequest = {
    baselineUpdateMode: 'none',
    capture: 'buffered',
    coverage: false,
    debug: {
        mode: 'off',
        selectors: []
    },
    execution: { mode: 'concurrent-in-process' },
    measureResourceUsage: null,
    order: 'plan',
    paths: [],
    profile: 'microtest',
    resourceBudgetOverrides: null,
    resourceUsageSamplingIntervalMilliseconds: null,
    seed: { value: 42n },
    selection: { kind: 'all' },
    shard: { index: 0, total: 1 },
    verbose: false
};

function plainData(value: unknown): unknown {
    return structuredClone(value);
}

function createPassingPlan(): RunCommand['testPlan'] {
    const engine = createTestEngine();

    return engine.createTestPlan(
        engine.createRoot({
            children: [
                engine.createTestCase({
                    body(testScope) {
                        testScope.assert.true(true, { message: 'passes' });
                        return testScope.assert.collect();
                    },
                    metadata: {},
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );
}

function createFinishedResourceUsageTracker(): RunResourceUsageTracker {
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
}

function createDeterministicRunOrchestrator(): RunOrchestrator {
    const engine = createTestEngine();

    return createRunOrchestrator({
        createResourceUsageTracker: createFinishedResourceUsageTracker,
        createSeed() {
            return 99n;
        },
        execute: engine.execute,
        node: {
            arch: 'x64',
            platform: 'linux',
            version: '26.1.1'
        },
        readStartedAt() {
            return '2026-07-15T12:30:00.000Z';
        }
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/run-resource-usage-policy.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() records resource usage policy from config and request overrides',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve({
                    config: {
                        ...defaultConfig,
                        profiles: {
                            microtest: {
                                measureResourceUsage: true,
                                resourceBudgets: {
                                    activeResourceCount: 8,
                                    javaScriptEngineHeapBytes: null,
                                    residentSetBytes: 200,
                                    residentSetGrowthBytesPerSecond: 50
                                },
                                resourceUsageSamplingIntervalMilliseconds: 25
                            }
                        }
                    },
                    request: {
                        ...defaultRequest,
                        resourceBudgetOverrides: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: 100,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        },
                        resourceUsageSamplingIntervalMilliseconds: 10
                    },
                    testPlan: createPassingPlan()
                });

                scope.assert.equal(Object.isFrozen(resolvedRun.facts.execution.resourceUsagePolicy), true);
                scope.assert.deepEqual(plainData(resolvedRun.facts.execution.resourceUsagePolicy), {
                    measureResourceUsage: true,
                    resourceBudgets: {
                        activeResourceCount: 8,
                        javaScriptEngineHeapBytes: 100,
                        residentSetBytes: 200,
                        residentSetGrowthBytesPerSecond: 50
                    },
                    resourceUsageSamplingIntervalMilliseconds: 10
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() records run-level resource usage when measurement is enabled',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run({
                    config: defaultConfig,
                    request: {
                        ...defaultRequest,
                        measureResourceUsage: true
                    },
                    testPlan: createPassingPlan()
                });

                scope.assert.deepEqual(plainData(result.resourceUsage), {
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
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() rejects budgeted execution until resource enforcement exists',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function runBudgetedRequest() {
                    await runOrchestrator.run({
                        config: {
                            ...defaultConfig,
                            profiles: {
                                microtest: {
                                    measureResourceUsage: true,
                                    resourceBudgets: {
                                        activeResourceCount: null,
                                        javaScriptEngineHeapBytes: null,
                                        residentSetBytes: 1,
                                        residentSetGrowthBytesPerSecond: null
                                    },
                                    resourceUsageSamplingIntervalMilliseconds: 100
                                }
                            }
                        },
                        request: defaultRequest,
                        testPlan: createPassingPlan()
                    });
                }, {
                    message: 'Resource budget enforcement is not implemented yet.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects resource budget overrides without measurement',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveUnmeasuredBudgetOverride() {
                    await runOrchestrator.resolve({
                        config: defaultConfig,
                        request: {
                            ...defaultRequest,
                            resourceBudgetOverrides: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: 1,
                                residentSetGrowthBytesPerSecond: null
                            }
                        },
                        testPlan: createPassingPlan()
                    });
                }, {
                    message: 'Resource budget overrides require resource usage measurement.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
