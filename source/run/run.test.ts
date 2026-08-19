import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createPlainOutputRenderer } from '../engine/reporter-output.ts';
import type { RunResourceUsageTracker } from '../engine/run-result.ts';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { RunResolutionError } from './run-errors.ts';
import { orchestrator } from './run-orchestrator.ts';
import {
    createRunOrchestrator,
    type RunCommand,
    type RunConfig,
    type RunRequest,
    type RunOrchestrator
} from './run.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly cwd: string;
    readonly engine: RunCommand['engine'];
    readonly request: RunRequest;
};

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';

const defaultConfig: RunConfig = {
    loader: {
        sourceMaps: false,
        stripMode: 'strip-only'
    },
    outputRenderer: createPlainOutputRenderer(),
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
    paths: [ passingFixturePath ],
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

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        cwd: overrides.cwd,
        engine: overrides.engine,
        request: overrides.request
    };
}

function createDeterministicRunOrchestrator(): RunOrchestrator {
    const engine = createTestEngine();

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
            return 99n;
        },
        defaultEngine: defaultRunEngine,
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
    name: 'source/run/run.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() returns frozen run facts for explicit paths',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
                    cwd: process.cwd(),
                    engine: null,
                    request: defaultRequest
                }));

                scope.assert.equal(Object.isFrozen(resolvedRun), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts.cases), true);
                scope.assert.deepEqual(plainData(resolvedRun.facts), {
                    cases: [
                        {
                            id: {
                                file: passingFixturePath,
                                name: 'passes',
                                params: null,
                                suite: [ 'fixture' ]
                            },
                            metadata: {
                                constructorName: 'Object',
                                entries: [
                                    {
                                        key: { kind: 'string', value: 'file' },
                                        value: { kind: 'string', truncation: null, value: 'passing' }
                                    },
                                    {
                                        key: { kind: 'string', value: 'tag' },
                                        value: { kind: 'string', truncation: null, value: 'fast' }
                                    }
                                ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ],
                    environment: {
                        node: {
                            arch: 'x64',
                            platform: 'linux',
                            version: '26.1.1'
                        },
                        runtimeStateDir: '.overkill'
                    },
                    execution: {
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        coverage: false,
                        debug: { mode: 'off', selectors: [] },
                        mode: 'concurrent-in-process',
                        order: 'plan',
                        profile: 'microtest',
                        resourceUsagePolicy: {
                            measureResourceUsage: false,
                            resourceBudgets: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            },
                            resourceUsageSamplingIntervalMilliseconds: 100
                        },
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        seed: '42',
                        shard: { index: 0, total: 1 }
                    }
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() generates a seed when the request does not provide one',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
                    cwd: process.cwd(),
                    engine: null,
                    request: {
                        ...defaultRequest,
                        seed: { value: null }
                    }
                }));

                scope.assert.equal(resolvedRun.facts.reproducibility.seed, '99');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects empty explicit input',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveEmptyPaths() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: null,
                        request: {
                            ...defaultRequest,
                            paths: []
                        }
                    }));
                }, {
                    message: 'No explicit run paths were provided.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects invalid negative seeds',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveInvalidSeed() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: null,
                        request: {
                            ...defaultRequest,
                            seed: { value: -1n }
                        }
                    }));
                }, {
                    message: 'Run seed must be a nonnegative bigint.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects unsupported sharding',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveUnsupportedShard() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        cwd: process.cwd(),
                        engine: null,
                        request: {
                            ...defaultRequest,
                            shard: { index: 1, total: 2 }
                        }
                    }));
                }, {
                    message: 'Sharding is not implemented yet.'
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.run() executes the resolved plan and reports run facts',
            metadata: {},
            async body(scope: OverkillScope) {
                const reporter = createInMemoryRealTimeReporter();
                const runOrchestrator = createDeterministicRunOrchestrator();
                const result = await runOrchestrator.run(createRunCommand({
                    config: {
                        ...defaultConfig,
                        reporters: [ reporter ]
                    },
                    cwd: process.cwd(),
                    engine: null,
                    request: defaultRequest
                }));
                const runStartEvent = reporter.getRecordedEntries()[0]?.event;

                scope.require.defined(runStartEvent);
                scope.assert.equal(runStartEvent.kind, 'run-start');
                scope.assert.deepEqual(plainData(runStartEvent.kind === 'run-start' ? runStartEvent.facts : null), {
                    cases: [
                        {
                            id: {
                                file: passingFixturePath,
                                name: 'passes',
                                params: null,
                                suite: [ 'fixture' ]
                            },
                            metadata: {
                                constructorName: 'Object',
                                entries: [
                                    {
                                        key: { kind: 'string', value: 'file' },
                                        value: { kind: 'string', truncation: null, value: 'passing' }
                                    },
                                    {
                                        key: { kind: 'string', value: 'tag' },
                                        value: { kind: 'string', truncation: null, value: 'fast' }
                                    }
                                ],
                                kind: 'object',
                                truncation: null
                            }
                        }
                    ],
                    environment: {
                        node: {
                            arch: 'x64',
                            platform: 'linux',
                            version: '26.1.1'
                        },
                        runtimeStateDir: '.overkill'
                    },
                    execution: {
                        baselineUpdateMode: 'none',
                        capture: 'buffered',
                        coverage: false,
                        debug: { mode: 'off', selectors: [] },
                        mode: 'concurrent-in-process',
                        order: 'plan',
                        profile: 'microtest',
                        resourceUsagePolicy: {
                            measureResourceUsage: false,
                            resourceBudgets: {
                                activeResourceCount: null,
                                javaScriptEngineHeapBytes: null,
                                residentSetBytes: null,
                                residentSetGrowthBytesPerSecond: null
                            },
                            resourceUsageSamplingIntervalMilliseconds: 100
                        },
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        seed: '42',
                        shard: { index: 0, total: 1 }
                    }
                });
                scope.assert.deepEqual(result.summary, {
                    defined: 2,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'RunResolutionError exposes stable error codes',
            metadata: {},
            async body(scope: OverkillScope) {
                const error = new RunResolutionError('Unsupported.', undefined, 'unsupported-request');

                scope.assert.equal(error.name, 'RunResolutionError');
                scope.assert.equal(error.code(), 'unsupported-request');

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
