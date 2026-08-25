import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite,
    createTestCase,
    runIfMain,
    type TestScope
} from '@overkill-dev/engine';
import type { Reporter } from '../../engine/reporter.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from '../../run/command-line-runner.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunCommand, RunConfig, RunProcessModel, RunRequest, RunScheduling } from '../../run/run-types.ts';
import type { LoadedRunConfig } from '../../run/run-config.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const duplicateFixtureAPath = 'source/integration-tests/run/fixtures/duplicate-a.test.ts';
const duplicateFixtureBPath = 'source/integration-tests/run/fixtures/duplicate-b.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const emptySuiteFixturePath = 'source/integration-tests/run/fixtures/empty-suite.test.ts';
const missingTestNodeFixturePath = 'source/integration-tests/run/fixtures/missing-test-node.test.ts';
const plainTestNodeFixturePath = 'source/integration-tests/run/fixtures/plain-test-node.test.ts';
const schedulingFixturePath = 'source/integration-tests/run/fixtures/scheduling.test.ts';
const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

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
                    events.push(`start:${event.case.name}`);
                } else if (event.kind === 'test-end') {
                    events.push(`end:${event.case.name}`);
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

async function loadConfiguredRunConfig(): Promise<LoadedRunConfig> {
    return {
        configPath: null,
        loader: defaultConfig.loader,
        outputRenderer: defaultConfig.outputRenderer,
        profiles: defaultConfig.profiles,
        reporters: [ memoryReporter ],
        runtimeStateDir: defaultConfig.runtimeStateDir
    };
}

function createRunnerDependencies(): CommandLineRunnerDependencies {
    return {
        async createDefaultReporter() {
            return memoryReporter;
        },
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        loadRunConfig: loadConfiguredRunConfig,
        orchestrator
    };
}

async function runCommandLine(paths: readonly string[]): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(createRunnerDependencies());

    return await runner.runTests({
        configPath: null,
        cwd: process.cwd(),
        request: createRunRequest(paths)
    });
}

function selectedEngineRunnerDiagnostic(path: string): string {
    return `Overkill runner error: Test module testNode must be created by the selected engine: ${path}`;
}

function plainData(value: unknown): unknown {
    return structuredClone(value);
}

export const testSuite = createSuite({
    name: 'source/integration-tests/run/runner-explicit-files.test.ts',
    metadata: {},
    children: [
        createTestCase({
            name: 'runner resolves and executes one explicit testNode file',
            metadata: {},
            async body(scope: TestScope) {
                const resolvedRun = await orchestrator.resolve(createRunCommand([ passingFixturePath ]));
                const result = await orchestrator.run(createRunCommand([ passingFixturePath ]));
                const firstCase = resolvedRun.facts.cases[0];

                scope.require.defined(firstCase);
                scope.assert.deepEqual(firstCase.id, {
                    file: passingFixturePath,
                    name: 'passes',
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
            name: 'runner executes a supervised microtest in a child process',
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
            name: 'runner runs in-process microtests concurrently from profile scheduling',
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
            name: 'runner runs in-process microtests serially from profile scheduling',
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
            name: 'runner runs supervised microtests concurrently from profile scheduling',
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
            name: 'runner runs supervised microtests serially from profile scheduling',
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
            name: 'runner kills a supervised microtest that blocks past hard timeout',
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
                    name: 'loops',
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
            name: 'runner uses file identity to distinguish duplicate case names across files',
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
                            name: 'same case',
                            params: null,
                            suite: [ 'same suite' ]
                        },
                        {
                            file: duplicateFixtureBPath,
                            name: 'same case',
                            params: null,
                            suite: [ 'same suite' ]
                        }
                    ]
                );

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'runner rejects invalid explicit paths before module import',
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
                    }, { message: 'Run path must be a file: source/integration-tests/run/fixtures' });
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
        }),
        createTestCase({
            name: 'command-line runner maps invalid module exports to runner errors',
            metadata: {},
            async body(scope: TestScope) {
                const missingExportResult = await runCommandLine([ missingTestNodeFixturePath ]);
                const plainExportResult = await runCommandLine([ plainTestNodeFixturePath ]);

                scope.assert.equal(missingExportResult.exitCode, 2);
                scope.assert.equal(plainExportResult.exitCode, 2);
                scope.assert.deepEqual(missingExportResult.fallbackDiagnostics, [
                    `Overkill runner error: Test module must export testNode: ${missingTestNodeFixturePath}`
                ]);
                scope.assert.deepEqual(plainExportResult.fallbackDiagnostics, [
                    selectedEngineRunnerDiagnostic(plainTestNodeFixturePath)
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'command-line runner maps collection failures to runner errors',
            metadata: {},
            async body(scope: TestScope) {
                const importFailureResult = await runCommandLine([ throwsOnImportFixturePath ]);
                const emptySuiteResult = await runCommandLine([ emptySuiteFixturePath ]);

                scope.assert.equal(importFailureResult.exitCode, 2);
                scope.assert.equal(emptySuiteResult.exitCode, 2);
                scope.assert.deepEqual(importFailureResult.fallbackDiagnostics, [
                    `Overkill runner error: Failed to load test module: ${throwsOnImportFixturePath}`
                ]);
                scope.assert.deepEqual(emptySuiteResult.fallbackDiagnostics, [
                    'Overkill runner error: Failed to collect tests from explicit run inputs.'
                ]);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            name: 'command-line runner maps empty explicit input to no tests collected',
            metadata: {},
            async body(scope: TestScope) {
                const result = await runCommandLine([]);

                scope.assert.equal(result.exitCode, 4);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill no tests collected: No explicit run paths were provided.'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createLineReporter() ] });
