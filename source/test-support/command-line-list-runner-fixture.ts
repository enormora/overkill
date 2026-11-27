import type { LoadedConfig, ConfiguredRunCommand, ResolvedRun, RunCommand } from '../packages/run/run.entry-point.ts';
import { defaultHistoryPolicy } from '../config/history-policy.ts';
import {
    defineOutputRenderer,
    defineReporter,
    type TestPlan,
    type DefinedReporter,
    type SinkDeclaration
} from '../packages/engine/engine.entry-point.ts';
import { snapshotRunCommand } from '../run/frozen-run-command.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from '../run/command-line-runner.ts';
import { selectTestProfile } from '../run/test-profile.ts';
import {
    unexpectedBenchmarkOrchestrator,
    defaultMicrotestProfile,
    testRunExecutionFacts
} from './run-command-factory.ts';
import { createTestEngine } from './create-test-engine.ts';

type ConfiguredRunOrchestrator = CommandLineRunnerDependencies['orchestrator'];

const plainOutputRenderer = defineOutputRenderer(function createPlainRuntimeOutputRenderer() {
    return {
        render(intent): string {
            return intent.text;
        }
    };
});

export function passiveReporter(name: string, sinks: readonly SinkDeclaration[]): DefinedReporter {
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

const memoryReporter = passiveReporter('memory', [ { kind: 'memory' } ]);

export async function loadDefaultConfig(): Promise<LoadedConfig> {
    return {
        history: defaultHistoryPolicy,
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

function caseFactsFromPlan(testPlan: TestPlan): ResolvedRun['facts']['cases'] {
    return testPlan.cases.map(function toRunCaseFacts(testCase) {
        return {
            annotations: { constructorName: 'Object', entries: [], kind: 'object', truncation: null },
            controls: { constructorName: 'Object', entries: [], kind: 'object', truncation: null },
            propertyPolicy: null,
            fileSet: null,
            id: testCase.id,
            workId: testCase.workId
        };
    });
}

export function createResolvedRun(
    suppliedCommand: ConfiguredRunCommand | RunCommand,
    collectionRunnerErrors: ResolvedRun['collectionRunnerErrors']
): ResolvedRun {
    const { command } = snapshotRunCommand(suppliedCommand);
    const profile = selectTestProfile(command.request.profile, command.config);
    const testPlan = createPassingPlan();

    return {
        collectionRunnerErrors,
        config: command.config,
        cwd: command.cwd,
        engine: command.engine,
        facts: {
            implementations: null,

            family: {
                id: testRunExecutionFacts(command, profile).testFamily,
                version: '1',
                settings: null,
                preparation: null,
                collection: null
            },
            adapter: null,
            benchmarkHost: null,
            benchmarkCalibration: null,
            benchmarkNormalization: null,
            benchmarkPlacement: null,
            coveragePolicy: null,
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
                selectedIdentities: [],
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
        reporters: command.config.reporters ?? [],
        request: command.request
    };
}

export function createListOnlyOrchestrator(resolve: ConfiguredRunOrchestrator['resolve']): ConfiguredRunOrchestrator {
    return {
        bench: unexpectedBenchmarkOrchestrator,
        resolve,
        async run() {
            throw new Error('List must not execute tests.');
        },
        async runWithReporterDelivery() {
            throw new Error('List must not execute tests.');
        }
    };
}

export async function createMemoryReporter(): Promise<DefinedReporter> {
    return memoryReporter;
}

export function createDependencies(
    orchestrator: ConfiguredRunOrchestrator,
    createDefaultReporter: () => Promise<DefinedReporter>
): CommandLineRunnerDependencies {
    return {
        createDefaultReporter,
        async loadReplayCommands() {
            throw new Error('Replay commands are not configured.');
        },
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        loadConfig: loadDefaultConfig,
        orchestrator
    };
}

export function createListDependencies(
    resolve: ConfiguredRunOrchestrator['resolve'],
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
            lastFailed: false,
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
