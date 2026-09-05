import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLineReporter } from '../../packages/reporter-line/reporter-line.entry-point.ts';
import {
    createSuite,
    createTestCase,
    runIfMain,
    type TestScope
} from '../../packages/engine/engine.entry-point.ts';
import type { Reporter } from '../../engine/reporter.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunProcessModel, RunRequest, RunScheduling } from '../../run/run-types.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const duplicateFixtureAPath = 'source/integration-tests/run/fixtures/duplicate-a.test.ts';
const duplicateFixtureBPath = 'source/integration-tests/run/fixtures/duplicate-b.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const schedulingFixturePath = 'source/integration-tests/run/fixtures/scheduling.test.ts';
const discoveryFixtureGlob = 'source/integration-tests/run/fixtures/discovery/*.test.ts';
const discoverySlowFixturePath = 'source/integration-tests/run/fixtures/discovery/slow.test.ts';

type SchedulingEvent = `end:${string}` | `start:${string}`;

type SchedulingEventRecorder = {
    readonly events: () => readonly SchedulingEvent[];
    readonly reporter: Reporter;
};

const memoryReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'memory',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'memory' } ]
};

function createDefaultMicrotestProfile(): RunConfig['profiles'][string] {
    return {
        execution: {
            processModel: 'supervised-process',
            scheduling: 'concurrent'
        },
        files: null,
        reporters: null,
        resourceUsage: {
            budgets: {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            measure: false,
            samplingIntervalMilliseconds: 100
        },
        testFamily: 'microtest',
        timeouts: {
            collectionMilliseconds: 5000,
            hardMilliseconds: 1000,
            softMilliseconds: 500
        }
    };
}

const defaultConfig: RunConfig = {
    loader: { sourceMaps: false, stripMode: 'strip-only' },
    outputRenderer: {
        render() {
            return '';
        }
    },
    profiles: {
        microtest: createDefaultMicrotestProfile()
    },
    reporters: [],
    runtimeStateDir: '.overkill'
};

function createRunRequest(paths: readonly string[]): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capabilityRestrictions: { mode: 'enabled' },
        capture: 'buffered',
        debug: { mode: 'off', selectors: [] },
        execution: { mode: 'profile-default' },
        measureResourceUsage: null,
        order: 'plan',
        paths,
        profile: 'microtest',
        resourceBudgetOverrides: null,
        resourceUsageSamplingIntervalMilliseconds: null,
        seed: { value: 42n },
        selection: { kind: 'all' },
        shard: { index: 0, total: 1 },
        verbose: false
    };
}

function createRunConfig(): RunConfig {
    return {
        ...defaultConfig,
        reporters: [ memoryReporter ]
    };
}

function createDiscoveryRunConfig(): RunConfig {
    return {
        ...defaultConfig,
        profiles: {
            microtest: {
                ...createDefaultMicrotestProfile(),
                files: {
                    exclude: [ discoverySlowFixturePath ],
                    include: [ discoveryFixtureGlob ]
                }
            }
        },
        reporters: [ memoryReporter ]
    };
}

function createSchedulingEventRecorder(): SchedulingEventRecorder {
    const events: SchedulingEvent[] = [];

    return {
        events() {
            return events;
        },
        reporter: {
            dispose: null,
            kind: 'real-time',
            name: 'scheduling-recorder',
            onEvent(event) {
                if (event.kind === 'test-start') {
                    events.push(`start:${event.case.title}`);
                } else if (event.kind === 'test-end') {
                    events.push(`end:${event.case.title}`);
                }
            },
            onFinish: null,
            sinks: [ { kind: 'memory' } ]
        }
    };
}

function createSchedulingRunConfig(
    processModel: RunProcessModel,
    scheduling: RunScheduling,
    reporter: Reporter
): RunConfig {
    return {
        ...defaultConfig,
        profiles: {
            microtest: {
                ...createDefaultMicrotestProfile(),
                execution: { processModel, scheduling }
            }
        },
        reporters: [ reporter ]
    };
}

function createRunCommand(paths: readonly string[]): RunCommand {
    return {
        config: createRunConfig(),
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: createRunRequest(paths)
    };
}

function createSupervisedRunCommand(paths: readonly string[], config: RunConfig): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: { kind: 'default' },
        request: {
            ...createRunRequest(paths),
            profile: 'microtest'
        }
    };
}

async function runSchedulingScenario(
    processModel: RunProcessModel,
    scheduling: RunScheduling
): Promise<readonly SchedulingEvent[]> {
    const recorder = createSchedulingEventRecorder();
    await orchestrator.run(createSupervisedRunCommand(
        [ schedulingFixturePath ],
        createSchedulingRunConfig(processModel, scheduling, recorder.reporter)
    ));

    return recorder.events();
}

function plainData(value: unknown): unknown {
    return structuredClone(value);
}

export const testSuite = createSuite({
    title: 'source/integration-tests/run/runner-explicit-files.test.ts',
    metadata: {},
    children: [
        createTestCase({
            title: 'runner resolves and executes one explicit testNode file',
            metadata: {},
            async body(scope: TestScope) {
                const resolvedRun = await orchestrator.resolve(createRunCommand([ passingFixturePath ]));
                const result = await orchestrator.run(createRunCommand([ passingFixturePath ]));
                const firstCase = resolvedRun.facts.cases[0];

                scope.require.defined(firstCase);
                scope.assert.deepEqual(firstCase.id, {
                    file: passingFixturePath,
                    title: 'passes',
                    params: null,
                    suite: [ 'fixture' ]
                });
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 2,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner executes a supervised microtest in a child process',
            metadata: {},
            async body(scope: TestScope) {
                const result = await orchestrator.run(
                    createSupervisedRunCommand([ passingFixturePath ], createRunConfig())
                );

                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 2,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 1,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });
                scope.assert.equal(result.runnerErrors.length, 0);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner resolves and executes profile-discovered files',
            metadata: {},
            async body(scope: TestScope) {
                const command = createSupervisedRunCommand([], createDiscoveryRunConfig());
                const resolvedRun = await orchestrator.resolve(command);
                const result = await orchestrator.run(command);

                scope.assert.deepEqual(
                    resolvedRun.facts.cases.map(function toCaseId(testCase) {
                        return testCase.id;
                    }),
                    [
                        {
                            file: 'source/integration-tests/run/fixtures/discovery/integration.test.ts',
                            title: 'integration passes',
                            params: null,
                            suite: [ 'discovery' ]
                        },
                        {
                            file: 'source/integration-tests/run/fixtures/discovery/unit.test.ts',
                            title: 'unit passes',
                            params: null,
                            suite: [ 'discovery' ]
                        }
                    ]
                );
                scope.assert.deepEqual(result.summary, {
                    crashed: 0,
                    defined: 4,
                    discovered: 2,
                    failed: 0,
                    inconclusive: 0,
                    passed: 2,
                    planned: 2,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner runs in-process microtests concurrently from profile scheduling',
            metadata: {},
            async body(scope: TestScope) {
                const events = await runSchedulingScenario('in-process', 'concurrent');

                scope.assert.deepEqual(events, [
                    'start:delayed',
                    'start:immediate',
                    'end:immediate',
                    'end:delayed'
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner runs in-process microtests serially from profile scheduling',
            metadata: {},
            async body(scope: TestScope) {
                const events = await runSchedulingScenario('in-process', 'serial');

                scope.assert.deepEqual(events, [
                    'start:delayed',
                    'end:delayed',
                    'start:immediate',
                    'end:immediate'
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner runs supervised microtests concurrently from profile scheduling',
            metadata: {},
            async body(scope: TestScope) {
                const events = await runSchedulingScenario('supervised-process', 'concurrent');

                scope.assert.deepEqual(events, [
                    'start:delayed',
                    'start:immediate',
                    'end:immediate',
                    'end:delayed'
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner runs supervised microtests serially from profile scheduling',
            metadata: {},
            async body(scope: TestScope) {
                const events = await runSchedulingScenario('supervised-process', 'serial');

                scope.assert.deepEqual(events, [
                    'start:delayed',
                    'end:delayed',
                    'start:immediate',
                    'end:immediate'
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner kills a supervised microtest that blocks past hard timeout',
            metadata: {},
            async body(scope: TestScope) {
                const result = await orchestrator.run(createSupervisedRunCommand(
                    [ endlessLoopFixturePath ],
                    {
                        ...createRunConfig(),
                        profiles: {
                            microtest: {
                                ...createDefaultMicrotestProfile(),
                                timeouts: {
                                    collectionMilliseconds: 5000,
                                    hardMilliseconds: 50,
                                    softMilliseconds: 10
                                }
                            }
                        }
                    }
                ));
                const error = result.runnerErrors[0];

                scope.require.defined(error);
                scope.assert.equal(error.subtype, 'crash');
                scope.assert.deepEqual(plainData(error.attributedTo), {
                    file: endlessLoopFixturePath,
                    title: 'loops',
                    params: null,
                    suite: []
                });
                scope.assert.deepEqual(result.summary, {
                    crashed: 1,
                    defined: 1,
                    discovered: 1,
                    failed: 0,
                    inconclusive: 0,
                    passed: 0,
                    planned: 1,
                    resourceExhausted: 0,
                    runtimePolicy: 0,
                    skipped: 0
                });

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner uses file identity to distinguish duplicate case names across files',
            metadata: {},
            async body(scope: TestScope) {
                const resolvedRun = await orchestrator.resolve(createRunCommand([
                    duplicateFixtureAPath,
                    duplicateFixtureBPath
                ]));

                scope.assert.deepEqual(
                    resolvedRun.facts.cases.map(function toCaseId(testCase) {
                        return testCase.id;
                    }),
                    [
                        {
                            file: duplicateFixtureAPath,
                            title: 'same case',
                            params: null,
                            suite: [ 'same suite' ]
                        },
                        {
                            file: duplicateFixtureBPath,
                            title: 'same case',
                            params: null,
                            suite: [ 'same suite' ]
                        }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createTestCase({
            title: 'runner rejects invalid explicit paths before module import',
            metadata: {},
            async body(scope: TestScope) {
                const outsideDirectory = await mkdtemp(join(tmpdir(), 'overkill-runner-'));
                const outsideFile = join(outsideDirectory, 'outside.test.ts');

                await writeFile(outsideFile, 'export const testNode = null;\n');

                try {
                    await scope.assert.rejects(async function resolveMissingPath() {
                        await orchestrator.resolve(createRunCommand([
                            'source/integration-tests/run/fixtures/missing.ts'
                        ]));
                    }, {
                        message: 'Run path does not exist: source/integration-tests/run/fixtures/missing.ts'
                    });
                    await scope.assert.rejects(async function resolveDirectoryPath() {
                        await orchestrator.resolve(createRunCommand([ 'source/integration-tests/run/fixtures' ]));
                    }, { message: 'Directory run paths require selected profile file discovery.' });
                    await scope.assert.rejects(async function resolveDuplicatePath() {
                        await orchestrator.resolve(createRunCommand([ passingFixturePath, passingFixturePath ]));
                    }, { message: `Run path must not be duplicated: ${passingFixturePath}` });
                    await scope.assert.rejects(async function resolveOutsidePath() {
                        await orchestrator.resolve(createRunCommand([ outsideFile ]));
                    }, { message: `Run path must stay inside cwd: ${outsideFile}` });
                } finally {
                    await rm(outsideDirectory, { force: true, recursive: true });
                }

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
