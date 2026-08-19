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
import { orchestrator } from '../../run/run-orchestrator.ts';
import type { RunCommand, RunConfig, RunRequest } from '../../run/run-types.ts';
import type { LoadedRunConfig } from '../../run/run-config.ts';

const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
const duplicateFixtureAPath = 'source/integration-tests/run/fixtures/duplicate-a.test.ts';
const duplicateFixtureBPath = 'source/integration-tests/run/fixtures/duplicate-b.test.ts';
const endlessLoopFixturePath = 'source/integration-tests/run/fixtures/endless-loop.test.ts';
const emptySuiteFixturePath = 'source/integration-tests/run/fixtures/empty-suite.test.ts';
const missingTestNodeFixturePath = 'source/integration-tests/run/fixtures/missing-test-node.test.ts';
const plainTestNodeFixturePath = 'source/integration-tests/run/fixtures/plain-test-node.test.ts';
const throwsOnImportFixturePath = 'source/integration-tests/run/fixtures/throws-on-import.test.ts';

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

const defaultConfig: RunConfig = {
    loader: { sourceMaps: false, stripMode: 'strip-only' },
    outputRenderer: {
        render() {
            return '';
        }
    },
    profiles: {
        microtest: {
            hardTimeoutMilliseconds: 1000,
            measureResourceUsage: false,
            resourceBudgets: {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            resourceUsageSamplingIntervalMilliseconds: 100,
            timeoutMilliseconds: 500
        },
        microtestSupervised: {
            hardTimeoutMilliseconds: 1000,
            measureResourceUsage: false,
            resourceBudgets: {
                activeResourceCount: null,
                javaScriptEngineHeapBytes: null,
                residentSetBytes: null,
                residentSetGrowthBytesPerSecond: null
            },
            resourceUsageSamplingIntervalMilliseconds: 100,
            timeoutMilliseconds: 500
        }
    },
    reporters: [],
    runtimeStateDir: '.overkill'
};

function createRunRequest(paths: readonly string[]): RunRequest {
    return {
        baselineUpdateMode: 'none',
        capture: 'buffered',
        coverage: false,
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

function createRunCommand(paths: readonly string[]): RunCommand {
    return {
        config: createRunConfig(),
        cwd: process.cwd(),
        engine: null,
        request: createRunRequest(paths)
    };
}

function createSupervisedRunCommand(paths: readonly string[], config: RunConfig): RunCommand {
    return {
        config,
        cwd: process.cwd(),
        engine: null,
        request: {
            ...createRunRequest(paths),
            profile: 'microtest-supervised'
        }
    };
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

function selectedEngineDiagnostic(path: string): string {
    return `Overkill argument error: Test module testNode must be created by the selected engine: ${path}`;
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

                scope.assert.deepEqual(resolvedRun.testPlan.cases[0].id, {
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
                    skipped: 0
                });
                scope.assert.equal(result.runnerErrors.length, 0);

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
                            microtest: defaultConfig.profiles.microtest,
                            microtestSupervised: {
                                hardTimeoutMilliseconds: 50,
                                measureResourceUsage: false,
                                resourceBudgets: {
                                    activeResourceCount: null,
                                    javaScriptEngineHeapBytes: null,
                                    residentSetBytes: null,
                                    residentSetGrowthBytesPerSecond: null
                                },
                                resourceUsageSamplingIntervalMilliseconds: 100,
                                timeoutMilliseconds: 10
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
                    resolvedRun.testPlan.cases.map(function toCaseId(testCase) {
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
            name: 'command-line runner maps invalid module exports to argument errors',
            metadata: {},
            async body(scope: TestScope) {
                const missingExportResult = await runCommandLine([ missingTestNodeFixturePath ]);
                const plainExportResult = await runCommandLine([ plainTestNodeFixturePath ]);

                scope.assert.equal(missingExportResult.exitCode, 3);
                scope.assert.equal(plainExportResult.exitCode, 3);
                scope.assert.deepEqual(missingExportResult.fallbackDiagnostics, [
                    `Overkill argument error: Test module must export testNode: ${missingTestNodeFixturePath}`
                ]);
                scope.assert.deepEqual(plainExportResult.fallbackDiagnostics, [
                    selectedEngineDiagnostic(plainTestNodeFixturePath)
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
