import { runIfMain } from '#test-runner';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import {
    defaultMicrotestProfile,
    defaultRunConfig,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import type { NormalizedConfig } from '../config/types.ts';
import type { RunCommand, RunRequest } from './run-types.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

const defaultConfig: NormalizedConfig = defaultRunConfig({
    outputRenderer: defineOutputRenderer(function createEmptyOutputRenderer() {
        return {
            render() {
                return '';
            }
        };
    }),
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

function createRunCommand(config: NormalizedConfig, request: RunRequest): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request
    };
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-process-usage-policy.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() records process usage policy from config and request overrides',
            annotations: {},
            controls: {},
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
                                processUsage: {
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
                        processBudgetOverrides: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: 100,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        },
                        processUsageSamplingIntervalMilliseconds: 10
                    }
                ));

                scope.assert.equal(Object.isFrozen(resolvedRun.facts.execution.processUsagePolicy), true);
                scope.assert.deepEqual(plainData(resolvedRun.facts.execution.processUsagePolicy), {
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() records run-level process usage when measurement is enabled',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand(
                    defaultConfig,
                    {
                        ...defaultRequest,
                        measureProcessUsage: true
                    }
                ));

                scope.assert.deepEqual(plainData(result.processUsage), {
                    activeResourceTypes: [],
                    end: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMicroseconds: 1,
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
                        capturedAtMicroseconds: 0,
                        javaScriptEngineHeapBytes: 1,
                        residentSetBytes: 2
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() accepts budgeted execution when measurement is enabled',
            annotations: {},
            controls: {},
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
                                processUsage: {
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.run() reports final process budget breaches for in-process microtests',
            annotations: {},
            controls: {},
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
                                processUsage: {
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
                scope.assert.equal(error.subtype, 'process-exhaustion');
                scope.assert.equal(error.attributedTo, null);
                scope.assert.deepEqual(plainData(error.cause), {
                    activeAttempts: [],
                    activeCases: [],
                    activeWork: [],
                    budget: 1,
                    enforcement: 'post-test-diagnostic',
                    metric: 'residentSetBytes',
                    observed: 3,
                    sample: {
                        activeResourceCount: 0,
                        activeResourceTypes: [],
                        capturedAtMicroseconds: 1,
                        javaScriptEngineHeapBytes: 2,
                        residentSetBytes: 3
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects process budget overrides without measurement',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveUnmeasuredBudgetOverride() {
                    await runOrchestrator.resolve(createRunCommand(
                        defaultConfig,
                        {
                            ...defaultRequest,
                            processBudgetOverrides: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: 1,
                                residentSetGrowthBytesPerSecond: null
                            }
                        }
                    ));
                }, {
                    message: 'Process budget overrides require process usage measurement.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() accepts disabled measurement with empty process budget overrides',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand(
                    defaultConfig,
                    {
                        ...defaultRequest,
                        measureProcessUsage: false,
                        processBudgetOverrides: {
                            activeResourceCount: null,
                            javaScriptEngineHeapBytes: null,
                            residentSetBytes: null,
                            residentSetGrowthBytesPerSecond: null
                        }
                    }
                ));

                scope.assert.deepEqual(plainData(resolvedRun.facts.execution.processUsagePolicy), {
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects invalid process usage request values',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();

                await scope.assert.rejects(async function resolveInvalidSamplingInterval() {
                    await runOrchestrator.resolve(createRunCommand(
                        defaultConfig,
                        {
                            ...defaultRequest,
                            processUsageSamplingIntervalMilliseconds: 0
                        }
                    ));
                }, {
                    message: 'Process usage sampling interval must be a positive safe integer.'
                });
                await scope.assert.rejects(async function resolveInvalidBudgetOverride() {
                    await runOrchestrator.resolve(createRunCommand(
                        defaultConfig,
                        {
                            ...defaultRequest,
                            measureProcessUsage: true,
                            processBudgetOverrides: {
                                activeResourceCount: 1.5,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            }
                        }
                    ));
                }, {
                    message: 'Active Node resource count budget must be a positive safe integer.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects timeout policies where soft exceeds hard timeout',
            annotations: {},
            controls: {},
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'orchestrator.resolve() rejects config budgets without measurement',
            annotations: {},
            controls: {},
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
                                    processUsage: {
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
                    message: 'Process budgets require process usage measurement.'
                });

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testNode);
