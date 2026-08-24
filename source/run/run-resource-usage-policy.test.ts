import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createWallClock } from '@enormora/wall-clock';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createReporterDispatcher } from '../engine/reporter-dispatcher.ts';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createRunOrchestrator } from './run.ts';
import type { RunCommand, RunConfig, RunOrchestrator, RunRequest } from './run-types.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

const defaultConfig: RunConfig = defaultRunConfig({
    outputRenderer: {
        render() {
            return '';
        }
    },
    profiles: {
        microtest: defaultMicrotestProfile({
            execution: {
                processModel: 'in-process'
            }
        })
    }
});

const defaultRequest: RunRequest = defaultRunRequest({ paths: [ passingFixturePath ] });

function plainData(value: unknown): unknown {
    return structuredClone(value);
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
    const wallClock = createWallClock();
    const environment = {};
    const reporterDispatcher = createReporterDispatcher({
        stderr: {
            writeLine() {
                return undefined;
            }
        },
        stdout: {
            writeLine() {
                return undefined;
            }
        },
        wallClock
    });

    return createRunOrchestrator({
        createResourceUsageTracker: createFinishedResourceUsageTracker,
        createSeed() {
            return 99n;
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

function createRunCommand(config: RunConfig, request: RunRequest): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: null,
        request
    };
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
                const resolvedRun = await runOrchestrator.resolve(createRunCommand(
                    {
                        ...defaultConfig,
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: {
                                    processModel: 'in-process'
                                },
                                resourceUsage: {
                                    budgets: {
                                        activeResourceCount: 8,
                                        residentSetBytes: 200,
                                        residentSetGrowthBytesPerSecond: 50
                                    },
                                    measure: true,
                                    samplingIntervalMilliseconds: 25
                                }
                            })
                        }
                    },
                    {
                        ...defaultRequest,
                        resourceBudgetOverrides: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: 100,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        },
                        resourceUsageSamplingIntervalMilliseconds: 10
                    }
                ));

                scope.assert.equal(Object.isFrozen(resolvedRun.facts.execution.resourceUsagePolicy), true);
                scope.assert.deepEqual(plainData(resolvedRun.facts.execution.resourceUsagePolicy), {
                    budgets: {
                        activeResourceCount: 8,
                        javaScriptEngineHeapBytes: 100,
                        residentSetBytes: 200,
                        residentSetGrowthBytesPerSecond: 50
                    },
                    measure: true,
                    samplingIntervalMilliseconds: 10
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() records run-level resource usage when measurement is enabled',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(
                    defaultConfig,
                    {
                        ...defaultRequest,
                        measureResourceUsage: true
                    }
                ));

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
            name: 'orchestrator.run() accepts budgeted execution when measurement is enabled',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                const result = await runOrchestrator.run(createRunCommand(
                    {
                        ...defaultConfig,
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: {
                                    processModel: 'in-process'
                                },
                                resourceUsage: {
                                    budgets: {
                                        residentSetBytes: 4
                                    },
                                    measure: true
                                }
                            })
                        }
                    },
                    defaultRequest
                ));

                scope.assert.equal(result.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() reports final resource budget breaches for in-process microtests',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                const result = await runOrchestrator.run(createRunCommand(
                    {
                        ...defaultConfig,
                        profiles: {
                            microtest: defaultMicrotestProfile({
                                execution: {
                                    processModel: 'in-process'
                                },
                                resourceUsage: {
                                    budgets: {
                                        residentSetBytes: 1
                                    },
                                    measure: true
                                }
                            })
                        }
                    },
                    defaultRequest
                ));
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'resource-exhaustion');
                scope.assert.equal(error.attributedTo, null);
                scope.assert.deepEqual(plainData(error.cause), {
                    activeCases: [],
                    budget: 1,
                    enforcement: 'post-test-diagnostic',
                    metric: 'residentSetBytes',
                    observed: 3,
                    sample: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMilliseconds: 1,
                        javaScriptEngineHeapBytes: 2,
                        residentSetBytes: 3
                    }
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
                    await runOrchestrator.resolve(createRunCommand(
                        defaultConfig,
                        {
                            ...defaultRequest,
                            resourceBudgetOverrides: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: 1,
                                residentSetGrowthBytesPerSecond: null
                            }
                        }
                    ));
                }, {
                    message: 'Resource budget overrides require resource usage measurement.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() accepts disabled measurement with empty resource budget overrides',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand(
                    defaultConfig,
                    {
                        ...defaultRequest,
                        measureResourceUsage: false,
                        resourceBudgetOverrides: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        }
                    }
                ));

                scope.assert.deepEqual(plainData(resolvedRun.facts.execution.resourceUsagePolicy), {
                    budgets: {
                        activeResourceCount: null,
                        javaScriptEngineHeapBytes: null,
                        residentSetBytes: null,
                        residentSetGrowthBytesPerSecond: null
                    },
                    measure: false,
                    samplingIntervalMilliseconds: 100
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects invalid resource usage request values',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidSamplingInterval() {
                    await runOrchestrator.resolve(createRunCommand(
                        defaultConfig,
                        {
                            ...defaultRequest,
                            resourceUsageSamplingIntervalMilliseconds: 0
                        }
                    ));
                }, {
                    message: 'Resource usage sampling interval must be a positive safe integer.'
                });
                await scope.assert.rejects(async function resolveInvalidBudgetOverride() {
                    await runOrchestrator.resolve(createRunCommand(
                        defaultConfig,
                        {
                            ...defaultRequest,
                            measureResourceUsage: true,
                            resourceBudgetOverrides: {
                                activeResourceCount: 1.5,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            }
                        }
                    ));
                }, {
                    message: 'Active resource count budget must be a positive safe integer.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects timeout policies where soft exceeds hard timeout',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidTimeoutPolicy() {
                    await runOrchestrator.resolve(createRunCommand(
                        {
                            ...defaultConfig,
                            profiles: {
                                ...defaultConfig.profiles,
                                microtest: defaultMicrotestProfile({
                                    execution: {
                                        processModel: 'in-process'
                                    },
                                    timeouts: {
                                        hardMilliseconds: 10,
                                        softMilliseconds: 20
                                    }
                                })
                            }
                        },
                        defaultRequest
                    ));
                }, {
                    message: 'Soft timeout must not exceed hard timeout.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects config budgets without measurement',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveDisabledConfigBudget() {
                    await runOrchestrator.resolve(createRunCommand(
                        {
                            ...defaultConfig,
                            profiles: {
                                microtest: defaultMicrotestProfile({
                                    execution: {
                                        processModel: 'in-process'
                                    },
                                    resourceUsage: {
                                        budgets: {
                                            activeResourceCount: 1
                                        },
                                        measure: false
                                    }
                                })
                            }
                        },
                        defaultRequest
                    ));
                }, {
                    message: 'Resource budgets require resource usage measurement.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
