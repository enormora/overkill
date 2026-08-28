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
import type { LoadedRunConfig } from '../../run/run-config.ts';
import { orchestrator } from '../../run/run-orchestrator.entry-point.ts';
import type { RunConfig, RunProcessModel, RunRequest } from '../../run/run-types.ts';

const emptySuiteFixturePath = 'source/integration-tests/run/fixtures/empty-suite.test.ts';
const missingTestNodeFixturePath = 'source/integration-tests/run/fixtures/missing-test-node.test.ts';
const passingFixturePath = 'source/integration-tests/run/fixtures/passing.test.ts';
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

function createLoadedRunConfig(config: RunConfig): LoadedRunConfig {
    return {
        configPath: null,
        loader: config.loader,
        outputRenderer: config.outputRenderer,
        profiles: config.profiles,
        reporters: [ memoryReporter ],
        runtimeStateDir: config.runtimeStateDir
    };
}

function createRunnerDependencies(config: RunConfig): CommandLineRunnerDependencies {
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
        async loadRunConfig() {
            return createLoadedRunConfig(config);
        },
        orchestrator
    };
}

async function runCommandLine(paths: readonly string[]): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(createRunnerDependencies(defaultConfig));

    return await runner.runTests({
        configPath: null,
        cwd: process.cwd(),
        runRequest: createRunRequest(paths)
    });
}

function listConfig(processModel: RunProcessModel): RunConfig {
    return {
        ...defaultConfig,
        profiles: {
            microtest: {
                ...createDefaultMicrotestProfile(),
                execution: {
                    processModel,
                    scheduling: 'concurrent'
                }
            }
        }
    };
}

async function listCommandLine(
    paths: readonly string[],
    processModel: RunProcessModel,
    withOrphans: boolean
): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(createRunnerDependencies(listConfig(processModel)));

    return await runner.listTests({
        configPath: null,
        cwd: process.cwd(),
        listRequest: {
            paths,
            profile: 'microtest',
            withOrphans
        }
    });
}

function selectedEngineRunnerDiagnostic(path: string): string {
    return `Overkill runner error: Test module testNode must be created by the selected engine: ${path}`;
}

export const testSuite = createSuite({
    name: 'source/integration-tests/run/runner-command-line.test.ts',
    metadata: {},
    children: [
        createTestCase({
            name: 'command-line runner lists explicit files without executing them',
            metadata: {},
            async body(scope: TestScope) {
                const localResult = await listCommandLine([ passingFixturePath ], 'in-process', false);
                const supervisedResult = await listCommandLine([ passingFixturePath ], 'supervised-process', true);

                scope.assert.equal(localResult.exitCode, 0);
                scope.assert.deepEqual(localResult.stdoutLines, [
                    passingFixturePath,
                    '  fixture',
                    '    passes'
                ]);
                scope.assert.equal(supervisedResult.exitCode, 0);
                scope.assert.deepEqual(supervisedResult.stdoutLines, [
                    passingFixturePath,
                    '  fixture',
                    '    passes',
                    'Orphans',
                    '  (none)'
                ]);

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
