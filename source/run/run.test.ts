import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import { createInMemoryRealTimeReporter } from '../reporters/in-memory-reporter.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    RunResolutionError,
    createRunOrchestrator,
    orchestrator,
    type RunCommand,
    type RunConfig,
    type RunRequest,
    type RunOrchestrator
} from './run.ts';

type RunCommandParts = {
    readonly config: RunConfig;
    readonly request: RunRequest;
    readonly testPlan: RunCommand['testPlan'];
};

const defaultConfig: RunConfig = {
    loader: {
        sourceMaps: false,
        stripMode: 'strip-only'
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
    order: 'plan',
    paths: [],
    profile: 'microtest',
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
                    metadata: {
                        count: 1n,
                        tag: 'fast'
                    },
                    name: 'passes'
                })
            ],
            metadata: {},
            name: 'root'
        })
    );
}

function createRunCommand(overrides: RunCommandParts): RunCommand {
    return {
        config: overrides.config,
        request: overrides.request,
        testPlan: overrides.testPlan
    };
}

function createDeterministicRunOrchestrator(): RunOrchestrator {
    const engine = createTestEngine();

    return createRunOrchestrator({
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
    name: 'source/run/run.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'orchestrator.resolve() returns frozen run facts for an explicit test plan',
            metadata: {},
            async body(scope: OverkillScope) {
                const runOrchestrator = createDeterministicRunOrchestrator();
                const resolvedRun = await runOrchestrator.resolve(createRunCommand({
                    config: defaultConfig,
                    request: defaultRequest,
                    testPlan: createPassingPlan()
                }));

                scope.assert.equal(Object.isFrozen(resolvedRun), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts), true);
                scope.assert.equal(Object.isFrozen(resolvedRun.facts.cases), true);
                scope.assert.deepEqual(plainData(resolvedRun.facts), {
                    cases: [
                        {
                            id: { file: null, name: 'passes', params: null, suite: [] },
                            metadata: {
                                constructorName: 'Object',
                                entries: [
                                    { key: { kind: 'string', value: 'count' }, value: { kind: 'bigint', value: '1' } },
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
                    request: {
                        ...defaultRequest,
                        seed: { value: null }
                    },
                    testPlan: createPassingPlan()
                }));

                scope.assert.equal(resolvedRun.facts.reproducibility.seed, '99');

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'orchestrator.resolve() rejects unsupported path discovery',
            metadata: {},
            async body(scope: OverkillScope) {
                await scope.assert.rejects(async function resolveUnsupportedPaths() {
                    await orchestrator.resolve(createRunCommand({
                        config: defaultConfig,
                        request: {
                            ...defaultRequest,
                            paths: [ 'source/**/*.test.ts' ]
                        },
                        testPlan: createPassingPlan()
                    }));
                }, {
                    message: 'Path discovery is not implemented yet.'
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
                        request: {
                            ...defaultRequest,
                            seed: { value: -1n }
                        },
                        testPlan: createPassingPlan()
                    }));
                }, {
                    message: 'Run seed must be a nonnegative bigint.'
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
                    request: defaultRequest,
                    testPlan: createPassingPlan()
                }));
                const runStartEvent = reporter.getRecordedEntries()[0]?.event;

                scope.require.defined(runStartEvent);
                scope.assert.equal(runStartEvent.kind, 'run-start');
                scope.assert.deepEqual(plainData(runStartEvent.kind === 'run-start' ? runStartEvent.facts : null), {
                    cases: [
                        {
                            id: { file: null, name: 'passes', params: null, suite: [] },
                            metadata: {
                                constructorName: 'Object',
                                entries: [
                                    { key: { kind: 'string', value: 'count' }, value: { kind: 'bigint', value: '1' } },
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
                        verbose: false
                    },
                    loader: { sourceMaps: false, stripMode: 'strip-only' },
                    reproducibility: {
                        seed: '42',
                        shard: { index: 0, total: 1 }
                    }
                });
                scope.assert.deepEqual(result.summary, {
                    defined: 1,
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
