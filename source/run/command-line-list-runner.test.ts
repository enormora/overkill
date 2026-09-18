import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    defineOutputRenderer,
    defineReporter,
    type TestCase,
    type TestCaseOptions,
    type TestScope as OverkillScope
} from '../packages/engine/engine.entry-point.ts';
import type { DefinedReporter, SinkDeclaration } from '../engine/reporter.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createTestEngine } from '../test-support/create-test-engine.ts';
import {
    defaultIntegrationProfile,
    defaultMicrotestProfile,
    testRunExecutionFacts
} from '../test-support/run-command-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { ResolvedRun, RunCommand, RunProfileConfig, RunOrchestrator, RunSelection } from './run-types.ts';

const plainOutputRenderer = defineOutputRenderer(function createPlainRuntimeOutputRenderer() {
    return {
        render(intent): string {
            return intent.text;
        }
    };
});

function passiveReporter(name: string, sinks: readonly SinkDeclaration[]): DefinedReporter {
    return defineReporter(function createPassiveReporter() {
        return {
            dispose: null,
            kind: 'real-time',
            name,
            onEvent() {
                return undefined;
            },
            onFinish: null,
            sinks
        };
    });
}

export const memoryReporter = passiveReporter('memory', [ { kind: 'memory' } ]);
const terminalReporter = passiveReporter('terminal', [ { kind: 'stdout-raw' } ]);

function listRunnerCase(
    title: string,
    body: TestCaseOptions['body']
): TestCase {
    return createOverkillTestCase({
        annotations: {},
        body,
        controls: {},
        definitionLocations: [ { kind: 'unknown' as const } ],
        title
    });
}

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
            id: testCase.id,
            workId: testCase.workId
        };
    });
}

export function createResolvedRun(
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
            durationHistory: null,
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
                shard: command.request.shard,
                shardHashAlgorithm: 'xxh3-64-canonical-json-v1'
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

export function createListOnlyOrchestrator(resolve: RunOrchestrator['resolve']): RunOrchestrator {
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

async function resolvePassingCommand(command: RunCommand): Promise<ResolvedRun> {
    return createResolvedRun(command, []);
}

export async function createMemoryReporter(): Promise<DefinedReporter> {
    return memoryReporter;
}

async function createTerminalReporter(): Promise<DefinedReporter> {
    return terminalReporter;
}

export function createDependencies(
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

export function createListDependencies(
    resolve: RunOrchestrator['resolve'],
    createDefaultReporter: () => Promise<DefinedReporter>
): CommandLineRunnerDependencies {
    return createDependencies(createListOnlyOrchestrator(resolve), createDefaultReporter);
}

export async function listTests(
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
            shard: { index: 1, total: 1 },
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
        listRunnerCase(
            'commandLineRunner.listTests() renders the resolved plan tree without loading reporters',
            async function body(scope: OverkillScope) {
                let defaultReporterLoadCount = 0;
                const receivedCommands: RunCommand[] = [];
                const dependencies = createDependencies(
                    createListOnlyOrchestrator(async function resolveCommand(command) {
                        receivedCommands.push(command);

                        return createResolvedRun(command, []);
                    }),
                    async function createCountingReporter() {
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
        ),
        listRunnerCase(
            'commandLineRunner.listTests() preserves list selection',
            async function body(scope: OverkillScope) {
                const receivedCommands: RunCommand[] = [];
                const integrationProfile = defaultIntegrationProfile({});
                const selection: RunSelection = {
                    filter: { field: 'tag', kind: 'equals', value: 'fast' },
                    kind: 'filter'
                };
                const dependencies = createListDependencies(
                    async function resolveCommand(command) {
                        receivedCommands.push(command);

                        return createResolvedRun(command, []);
                    },
                    createTerminalReporter
                );
                const runner = createCommandLineRunner({
                    ...dependencies,
                    async loadRunConfig() {
                        const config = await loadDefaultConfig();

                        return {
                            ...config,
                            profiles: {
                                ...config.profiles,
                                integration: integrationProfile
                            }
                        };
                    }
                });

                await runner.listTests({
                    configPath: null,
                    cwd: process.cwd(),
                    listRequest: {
                        order: 'seeded',
                        paths: [ 'source/integration.test.ts' ],
                        profile: 'integration',
                        seed: { value: 42n },
                        selection,
                        shard: { index: 1, total: 1 },
                        withLocations: false,
                        withOrphans: false
                    }
                });

                scope.require.defined(receivedCommands[0]);
                scope.assert.deepEqual(receivedCommands[0].request.selection, selection);

                return scope.assert.collect();
            }
        ),
        listRunnerCase(
            'commandLineRunner.listTests() renders definition locations when requested',
            async function body(scope: OverkillScope) {
                const result = await listTests(
                    createListDependencies(resolvePassingCommand, createMemoryReporter),
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
        ),
        listRunnerCase(
            'commandLineRunner.listTests() renders explicit orphan diagnostics',
            async function body(scope: OverkillScope) {
                const result = await listTests(
                    createListDependencies(resolvePassingCommand, createMemoryReporter),
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
        ),
        listRunnerCase(
            'commandLineRunner.listTests() renders orphan definition locations when requested',
            async function body(scope: OverkillScope) {
                const result = await listTests(
                    createListDependencies(createResolvedRunWithOrphanLocation, createMemoryReporter),
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
        )
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
