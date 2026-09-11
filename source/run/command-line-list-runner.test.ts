import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    defineReporter,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defaultMicrotestProfile,
    testRunExecutionFacts
} from '../test-support/run-command-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import { RunCollectionError } from './run-errors.ts';
import type { ResolvedRun, RunCommand, RunProfileConfig, RunOrchestrator, RunSelection } from './run-types.ts';

const plainOutputRenderer = defineOutputRenderer(function createPlainRuntimeOutputRenderer() {
    return {
        render(intent): string {
            return intent.text;
        }
    };
});

const memoryReporter = defineReporter(function createMemoryReporter() {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'memory',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'memory' } ]
    };
});

const terminalReporter = defineReporter(function createTerminalReporter() {
    return {
        dispose: null,
        kind: 'real-time',
        name: 'terminal',
        onEvent() {
            return undefined;
        },
        onFinish: null,
        sinks: [ { kind: 'stdout-raw' } ]
    };
});

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
    const suiteLocation = { column: 5, file: `${process.cwd()}/source/a.test.ts`, kind: 'known' as const, line: 3 };
    const testLocation = { column: 9, file: `${process.cwd()}/source/a.test.ts`, kind: 'known' as const, line: 5 };
    const testNode = engine.createSuite({
        children: [
            engine.createTestCase({
                body(scope) {
                    scope.assert.true(true);
                    return scope.assert.collect();
                },
                definitionLocations: [ testLocation ],
                annotations: {},
                controls: {},
                title: 'passes'
            })
        ],
        definitionLocations: [ suiteLocation ],
        annotations: {},
        controls: {},
        title: 'suite'
    });

    return engine.createTestPlanFromTestFiles({
        files: [ { file: 'source/a.test.ts', testNode } ],
        root: {
            annotations: {},
            controls: {},
            title: 'root'
        }
    });
}

function selectedProfile(command: RunCommand): RunProfileConfig {
    const profile = command.config.profiles[command.request.profile];

    if (profile === undefined) {
        throw new Error(`Missing profile ${command.request.profile}.`);
    }

    return profile;
}

function caseFactsFromPlan(testPlan: TestPlan): ResolvedRun['facts']['cases'] {
    return testPlan.cases.map(function toRunCaseFacts(testCase) {
        return {
            annotations: { constructorName: 'Object', entries: [], kind: 'object', truncation: null },
            controls: { constructorName: 'Object', entries: [], kind: 'object', truncation: null },
            fileSet: null,
            id: testCase.id
        };
    });
}

function createResolvedRun(
    command: RunCommand,
    collectionRunnerErrors: ResolvedRun['collectionRunnerErrors']
): ResolvedRun {
    const profile = selectedProfile(command);
    const testPlan = createPassingPlan();

    return {
        collectionRunnerErrors,
        config: command.config,
        cwd: command.cwd,
        engine: command.engine,
        facts: {
            cases: caseFactsFromPlan(testPlan),
            environment: {
                node: { arch: 'x64', platform: 'linux', version: '26.1.1' },
                projectRoot: command.cwd,
                runtimeStateDir: command.config.runtimeStateDir
            },
            execution: testRunExecutionFacts(command, profile),
            loader: command.config.loader,
            reproducibility: {
                selection: command.request.selection,
                seed: '42',
                shard: command.request.shard
            }
        },
        plan: {
            kind: 'local',
            testPlan
        },
        reporters: command.config.reporters,
        request: command.request
    };
}

async function createResolvedRunWithOrphanLocation(command: RunCommand): Promise<ResolvedRun> {
    const resolvedRun = createResolvedRun(command, []);

    if (resolvedRun.plan.kind !== 'local') {
        throw new Error('Expected local resolved run.');
    }

    return {
        ...resolvedRun,
        plan: {
            collectedPlan: {
                defined: 1,
                discoveredFiles: [],
                files: [],
                orphans: [
                    {
                        definitionLocations: [ {
                            column: 11,
                            file: `${process.cwd()}/source/orphan.test.ts`,
                            kind: 'known' as const,
                            line: 7
                        } ],
                        file: null,
                        kind: 'suite',
                        title: 'unused'
                    }
                ],
                root: resolvedRun.plan.testPlan.root
            },
            kind: 'supervised'
        }
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
    createDefaultReporter: () => Promise<DefinedReporter>
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
    withLocations: boolean,
    withOrphans: boolean
): Promise<CommandLineRunnerResult> {
    const runner = createCommandLineRunner(dependencies);

    return await runner.listTests({
        configPath: null,
        cwd: process.cwd(),
        listRequest: {
            order: 'seeded',
            paths: [ 'source/a.test.ts' ],
            profile: 'microtest',
            seed: { value: 42n },
            selection: { kind: 'all' },
            withLocations,
            withOrphans
        }
    });
}

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/command-line-list-runner.test.ts',
    annotations: {},
    controls: {},
    children: [
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() renders the resolved plan tree without loading reporters',
            annotations: {},
            controls: {},
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
                const result = await listTests(dependencies, false, false);

                scope.assert.equal(result.exitCode, 0);
                scope.assert.equal(defaultReporterLoadCount, 0);
                scope.assert.deepEqual(result.stdoutLines, [
                    'order=seeded seed=42',
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() preserves list selection',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const receivedCommands: RunCommand[] = [];
                const selection: RunSelection = {
                    filter: { field: 'tag', kind: 'equals', value: 'fast' },
                    kind: 'filter'
                };
                const runner = createCommandLineRunner(createDependencies(
                    createListOnlyOrchestrator(async function resolveCommand(command) {
                        receivedCommands.push(command);

                        return createResolvedRun(command, []);
                    }),
                    async function createDefaultReporter() {
                        return terminalReporter;
                    }
                ));

                await runner.listTests({
                    configPath: null,
                    cwd: process.cwd(),
                    listRequest: {
                        order: 'seeded',
                        paths: [ 'source/a.test.ts' ],
                        profile: 'microtest',
                        seed: { value: 42n },
                        selection,
                        withLocations: false,
                        withOrphans: false
                    }
                });

                scope.require.defined(receivedCommands[0]);
                scope.assert.deepEqual(receivedCommands[0].request.selection, selection);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() renders definition locations when requested',
            annotations: {},
            controls: {},
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
                    true,
                    false
                );

                scope.assert.deepEqual(result.stdoutLines, [
                    'order=seeded seed=42',
                    'source/a.test.ts',
                    '  suite (source/a.test.ts:3:5)',
                    '    passes (source/a.test.ts:5:9)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() renders explicit orphan diagnostics',
            annotations: {},
            controls: {},
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
                    false,
                    true
                );

                scope.assert.deepEqual(result.stdoutLines, [
                    'order=seeded seed=42',
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() renders orphan definition locations when requested',
            annotations: {},
            controls: {},
            async body(scope: OverkillScope) {
                const result = await listTests(
                    createDependencies(
                        createListOnlyOrchestrator(createResolvedRunWithOrphanLocation),
                        async function createDefaultReporter() {
                            return memoryReporter;
                        }
                    ),
                    true,
                    true
                );

                scope.assert.deepEqual(result.stdoutLines, [
                    'order=seeded seed=42',
                    'Orphans',
                    '  suite: unused (<unknown>) (source/orphan.test.ts:7:11)'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() maps collection runner errors without printing the plan',
            annotations: {},
            controls: {},
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
                    false,
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() maps config load errors',
            annotations: {},
            controls: {},
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
                        order: 'seeded',
                        paths: [ 'source/a.test.ts' ],
                        profile: 'microtest',
                        seed: { value: 42n },
                        selection: { kind: 'all' },
                        withLocations: false,
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
            definitionLocations: [ { kind: 'unknown' as const } ],
            title: 'commandLineRunner.listTests() maps thrown collection errors',
            annotations: {},
            controls: {},
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
                    false,
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

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
