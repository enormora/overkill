import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import {
    createSuite as createOverkillSuite,
    createTestCase as createOverkillTestCase,
    runIfMain,
    type TestScope as OverkillScope
} from '@overkill-dev/engine';
import type { Reporter } from '../engine/reporter.ts';
import { runResultFactory } from '../test-support/run-result-factory.ts';
import {
    defaultMicrotestProfile,
    defaultRunRequest
} from '../test-support/run-command-factory.ts';
import {
    createCommandLineRunner,
    type CommandLineRunnerDependencies,
    type CommandLineRunnerResult
} from './command-line-runner.ts';
import { RunResolutionError } from './run-errors.ts';
import type { LoadedRunConfig } from './run-config.ts';
import type { RunCommand, RunMicrotestProfileConfig, RunOrchestrator, RunRequest } from './run-types.ts';

type PlainOutputIntent = {
    readonly text: string;
};

type ReporterLoader = {
    readonly createDefaultReporter: () => Promise<Reporter>;
    readonly loadCount: () => number;
};

type CommandLineScenario = {
    readonly command: RunCommand;
    readonly result: CommandLineRunnerResult;
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

const defaultRequest = defaultRunRequest();

function loadedConfig(
    reporters: LoadedRunConfig['reporters'],
    profileReporters: readonly Reporter[] | null
): LoadedRunConfig {
    return {
        configPath: null,
        loader: { sourceMaps: false, stripMode: 'strip-only' },
        outputRenderer: plainOutputRenderer,
        profiles: {
            microtest: {
                ...defaultMicrotestProfile(),
                reporters: profileReporters
            }
        },
        reporters,
        runtimeStateDir: '.overkill'
    };
}

function selectedProfile(command: RunCommand): RunMicrotestProfileConfig {
    const profile = command.config.profiles[command.request.profile];

    if (profile === undefined) {
        throw new Error(`Missing profile ${command.request.profile}.`);
    }

    return profile;
}

function selectedProfileReporters(command: RunCommand): readonly Reporter[] {
    const { reporters } = selectedProfile(command);

    if (reporters === null) {
        throw new Error(`Missing profile reporters for ${command.request.profile}.`);
    }

    return reporters;
}

function createDefaultReporterLoader(reporter: Reporter): ReporterLoader {
    let loadCount = 0;

    return {
        async createDefaultReporter() {
            loadCount += 1;

            return reporter;
        },
        loadCount() {
            return loadCount;
        }
    };
}

function createRunnerDependencies(
    config: LoadedRunConfig,
    defaultReporterLoader: ReporterLoader,
    run: RunOrchestrator['run']
): CommandLineRunnerDependencies {
    return {
        createDefaultReporter: defaultReporterLoader.createDefaultReporter,
        async loadBaselineCommands() {
            throw new Error('Baseline commands are not configured.');
        },
        async loadBenchmarkCommands() {
            throw new Error('Benchmark commands are not configured.');
        },
        async loadRunConfig() {
            return config;
        },
        orchestrator: {
            async resolve() {
                throw new Error('Resolve is not used by the command-line runner.');
            },
            run
        }
    };
}

async function runScenario(
    config: LoadedRunConfig,
    defaultReporterLoader: ReporterLoader,
    request: RunRequest,
    run: RunOrchestrator['run']
): Promise<CommandLineScenario> {
    const receivedCommands: RunCommand[] = [];
    const runner = createCommandLineRunner(createRunnerDependencies(
        config,
        defaultReporterLoader,
        async function runCommand(command) {
            receivedCommands.push(command);

            return await run(command);
        }
    ));
    const result = await runner.runTests({ configPath: null, cwd: process.cwd(), request });
    const command = receivedCommands[0];

    if (command === undefined) {
        throw new Error('Missing run command.');
    }

    return { command, result };
}

async function passingRun(): ReturnType<RunOrchestrator['run']> {
    return runResultFactory.build({
        perTest: [ { outcome: { kind: 'pass' } } ],
        summary: { defined: 1, discovered: 1, passed: 1, planned: 1 }
    });
}

async function unknownProfileRun(): ReturnType<RunOrchestrator['run']> {
    throw new RunResolutionError('Unknown run profile: missing', undefined, 'invalid-request');
}

async function runWithRunnerErrors(): ReturnType<RunOrchestrator['run']> {
    return runResultFactory.build({
        runnerErrors: [
            { message: 'Loader failed.', subtype: 'loader' },
            { message: 'Dispose failed.', subtype: 'reporter' }
        ],
        summary: { defined: 1, discovered: 1, planned: 1 }
    });
}

export const testSuite = createOverkillSuite({
    name: 'source/run/command-line-runner-reporter-resolution.test.ts',
    metadata: {},
    children: [
        createOverkillTestCase({
            name:
                'commandLineRunner.runTests() keeps global reporters as fallback when profile reporters override them',
            metadata: {},
            async body(scope: OverkillScope) {
                const defaultReporter = createDefaultReporterLoader(memoryReporter);
                const scenario = await runScenario(
                    loadedConfig([ terminalReporter ], [ memoryReporter ]),
                    defaultReporter,
                    defaultRequest,
                    passingRun
                );

                scope.assert.equal(scenario.result.exitCode, 0);
                scope.assert.equal(defaultReporter.loadCount(), 0);
                scope.assert.equal(scenario.command.config.reporters[0], terminalReporter);
                scope.assert.equal(selectedProfileReporters(scenario.command)[0], memoryReporter);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() skips the default reporter when profile reporters exist',
            metadata: {},
            async body(scope: OverkillScope) {
                const defaultReporter = createDefaultReporterLoader(terminalReporter);
                const scenario = await runScenario(
                    loadedConfig(null, [ memoryReporter ]),
                    defaultReporter,
                    defaultRequest,
                    passingRun
                );

                scope.assert.equal(defaultReporter.loadCount(), 0);
                scope.assert.deepEqual(scenario.command.config.reporters, []);
                scope.assert.equal(selectedProfileReporters(scenario.command)[0], memoryReporter);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() skips the default reporter when global non-terminal reporters exist',
            metadata: {},
            async body(scope: OverkillScope) {
                const defaultReporter = createDefaultReporterLoader(terminalReporter);
                const scenario = await runScenario(
                    loadedConfig([ memoryReporter ], null),
                    defaultReporter,
                    defaultRequest,
                    passingRun
                );

                scope.assert.equal(defaultReporter.loadCount(), 0);
                scope.assert.equal(scenario.command.config.reporters[0], memoryReporter);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() skips the default reporter for unknown profiles',
            metadata: {},
            async body(scope: OverkillScope) {
                const defaultReporter = createDefaultReporterLoader(memoryReporter);
                const scenario = await runScenario(
                    loadedConfig(null, null),
                    defaultReporter,
                    { ...defaultRequest, profile: 'missing' },
                    unknownProfileRun
                );

                scope.assert.equal(scenario.result.exitCode, 3);
                scope.assert.equal(defaultReporter.loadCount(), 0);
                scope.assert.deepEqual(scenario.command.config.reporters, []);
                scope.assert.deepEqual(scenario.result.fallbackDiagnostics, [
                    'Overkill argument error: Unknown run profile: missing'
                ]);

                return scope.assert.collect();
            }
        }),
        createOverkillTestCase({
            name: 'commandLineRunner.runTests() uses profile terminal reporters for fallback diagnostics',
            metadata: {},
            async body(scope: OverkillScope) {
                const defaultReporter = createDefaultReporterLoader(memoryReporter);
                const scenario = await runScenario(
                    loadedConfig(null, [ terminalReporter ]),
                    defaultReporter,
                    defaultRequest,
                    runWithRunnerErrors
                );

                scope.assert.equal(scenario.result.exitCode, 2);
                scope.assert.equal(defaultReporter.loadCount(), 0);
                scope.assert.deepEqual(scenario.result.fallbackDiagnostics, [
                    'Overkill runner error: Dispose failed.'
                ]);

                return scope.assert.collect();
            }
        })
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
