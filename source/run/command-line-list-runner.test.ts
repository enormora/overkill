import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Reporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import { defaultMicrotestProfile } from '../test-support/run-command-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import { RunCollectionError } from './run-errors.ts';
import type { ResolvedRun, RunCommand, RunMicrotestProfileConfig, RunOrchestrator } from './run-types.ts';

type PlainOutputIntent = {
    readonly text: string;
};

const plainOutputRenderer = {
    render(intent: PlainOutputIntent): string {
        return intent.text;
    }
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

const terminalReporter: Reporter = {
    dispose: null,
    kind: 'real-time',
    name: 'terminal',
    onEvent() {
        return undefined;
    },
    onFinish: null,
    sinks: [ { kind: 'stdout-raw' } ]
};

async function loadDefaultConfig(): Promise<LoadedRunConfig> {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: plainOutputRenderer,
        profiles: {
            microtest: defaultMicrotestProfile()
        },
        reporters: null,
        runtimeStateDir: '.overkill'
    };
}

function createPassingPlan(): TestPlan {
    const engine = createTestEngine();
    const testNode = engine.createSuite({
        children: [
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                metadata: {},
                name: 'passes'
            })
        ],
        metadata: {},
        name: 'suite'
    });

    return engine.createTestPlanFromTestFiles({
        files: [ { file: 'source/a.test.ts', testNode } ],
        root: {
            metadata: {},
            name: 'root'
        }
    });
}

function selectedProfile(command: RunCommand): RunMicrotestProfileConfig {
    const profile = command.config.profiles[command.request.profile];

    if (profile === undefined) {
        throw new Error(`Missing profile ${command.request.profile}.`);
    }

    return profile;
}

function createResolvedRun(
    command: RunCommand,
    collectionRunnerErrors: ResolvedRun['collectionRunnerErrors']
): ResolvedRun {
    const profile = selectedProfile(command);

    return {
        collectionRunnerErrors,
        config: command.config,
        cwd: command.cwd,
        engine: command.engine,
        facts: {
            cases: [],
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                runtimeStateDir: command.config.runtimeStateDir
            },
            execution: {
                baselineUpdateMode: command.request.baselineUpdateMode,
                capture: command.request.capture,
                debug: command.request.debug,
                engine: { kind: 'default' },
                order: command.request.order,
                processModel: profile.execution.processModel,
                profile: command.request.profile,
                resourceUsagePolicy: profile.resourceUsage,
                scheduling: profile.execution.scheduling,
                testFamily: profile.testFamily,
                timeoutPolicy: profile.timeouts,
                verbose: command.request.verbose
            },
            loader: command.config.loader,
            reproducibility: {
                seed: '42',
                shard: command.request.shard
            }
        },
        plan: {
            kind: 'local',
            testPlan: createPassingPlan()
        },
        reporters: command.config.reporters,
        request: command.request
    };
}

function createListOnlyOrchestrator(resolve: RunOrchestrator['resolve']): RunOrchestrator {
    return {
        resolve,
        async run() {
            throw new Error('List must not execute tests.');
        },
        async runWithReporterDelivery() {
            throw new Error('List must not execute tests.');
        }
    };
}

function createDependencies(
    orchestrator: RunOrchestrator,
    createDefaultReporter: () => Promise<Reporter>
): CommandLineRunnerDependencies {
    return {
        createDefaultReporter,
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        loadRunConfig: loadDefaultConfig,
        orchestrator
    };
}

async function listTests(
    dependencies: CommandLineRunnerDependencies,
    withOrphans: boolean
): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(dependencies);

    return await runner.listTests({
        configPath: null,
        cwd: process.cwd(),
        listRequest: {
            paths: [ 'source/a.test.ts' ],
            profile: 'microtest',
            withOrphans
        }
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-list-runner.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name: 'commandLineRunner.listTests() renders the resolved plan tree without loading reporters',
            metadata: {},
            async body(scope: OverkillScope) {
                let defaultReporterLoadCount = 0;
                const receivedCommands: RunCommand[] = [];
                const dependencies = createDependencies(
                    createListOnlyOrchestrator(async function resolveCommand(command) {
                        receivedCommands.push(command);

                        return createResolvedRun(command, []);
                    }),
                    async function createDefaultReporter() {
                        defaultReporterLoadCount += 1;

                        return terminalReporter;
                    }
                );
                const result = await listTests(dependencies, false);

                scope.assert.equal(result.exitCode, 0);
                scope.assert.equal(defaultReporterLoadCount, 0);
                scope.assert.deepEqual(result.stdoutLines, [
                    'source/a.test.ts',
                    '  suite',
                    '    passes'
                ]);
                scope.require.defined(receivedCommands[0]);
                scope.assert.deepEqual(receivedCommands[0].config.reporters, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.listTests() renders explicit orphan diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await listTests(
                    createDependencies(
                        createListOnlyOrchestrator(async function resolveCommand(command) {
                            return createResolvedRun(command, []);
                        }),
                        async function createDefaultReporter() {
                            return memoryReporter;
                        }
                    ),
                    true
                );

                scope.assert.deepEqual(result.stdoutLines, [
                    'source/a.test.ts',
                    '  suite',
                    '    passes',
                    'Orphans',
                    '  (none)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.listTests() maps collection runner errors without printing the plan',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await listTests(
                    createDependencies(
                        createListOnlyOrchestrator(async function resolveCommand(command) {
                            return createResolvedRun(command, [
                                {
                                    attributedTo: null,
                                    cause: null,
                                    message: 'Collection failed.',
                                    subtype: 'loader'
                                }
                            ]);
                        }),
                        async function createDefaultReporter() {
                            return memoryReporter;
                        }
                    ),
                    false
                );

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.stdoutLines, []);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill runner error: Collection failed.'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.listTests() maps config load errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const runner = createCommandLineRunner({
                    ...createDependencies(
                        createListOnlyOrchestrator(async function resolveCommand(command) {
                            return createResolvedRun(command, []);
                        }),
                        async function createDefaultReporter() {
                            return memoryReporter;
                        }
                    ),
                    async loadRunConfig() {
                        throw new Error('Config failed.');
                    }
                });
                const result = await runner.listTests({
                    configPath: null,
                    cwd: process.cwd(),
                    listRequest: {
                        paths: [ 'source/a.test.ts' ],
                        profile: 'microtest',
                        withOrphans: false
                    }
                });

                scope.assert.equal(result.exitCode, 70);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill internal error: Config failed.'
                ]);
                scope.assert.deepEqual(result.stdoutLines, []);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.listTests() maps thrown collection errors',
            metadata: {},
            async body(scope: OverkillScope) {
                const result = await listTests(
                    createDependencies(
                        createListOnlyOrchestrator(async function resolveCommand() {
                            throw new RunCollectionError('Collection failed.', { cause: null }, 'loader');
                        }),
                        async function createDefaultReporter() {
                            return memoryReporter;
                        }
                    ),
                    false
                );

                scope.assert.equal(result.exitCode, 2);
                scope.assert.deepEqual(result.fallbackDiagnostics, [
                    'Overkill runner error: Collection failed.'
                ]);
                scope.assert.deepEqual(result.stdoutLines, []);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
