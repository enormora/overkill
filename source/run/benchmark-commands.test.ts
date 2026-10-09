import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import {
    normalizeConfig,
    type Config,
    type ConfigLoader,
    type ConfigLoadRequest
} from '../packages/run/config.entry-point.ts';
import { createNullReporter } from '../reporters/null-reporter.ts';
import { createDeterministicRunOrchestrator } from '../test-support/create-deterministic-run-orchestrator.ts';
import { defaultRunRequest } from '../test-support/run-command-factory.ts';
import { configFixtureCwd, createSingleConfigModuleLoader } from '../test-support/run-config-module-loader.ts';
import { createBenchmarkCommands } from './benchmark-commands.ts';
import type { CommandLineBenchmarkCommands, CommandLineRunnerResult } from './command-line-command.ts';
import type { RunCommand } from './run-types.ts';

const benchmark = {
    testFamily: 'benchmark',
    files: { include: [ 'missing.bench.ts' ] },
    execution: { processModel: 'supervised-process' }
} as const;
const ordinary = { testFamily: 'microtest' } as const;
const verbs = [ 'runBenchmarks', 'listBenchmarks' ] as const;

type SelectionScenario = {
    readonly config: Config;
    readonly diagnostic: string;
    readonly profile: string | null;
};

type SelectedProfileScenario = {
    readonly profiles: NonNullable<Config['profiles']>;
    readonly profile: string | null;
    readonly selected: string;
};

const selectionErrors: readonly SelectionScenario[] = [
    {
        config: { profiles: { startup: benchmark } },
        diagnostic: 'Unknown benchmark profile: "missing".',
        profile: 'missing'
    },
    {
        config: { profiles: { startup: benchmark } },
        diagnostic: 'Unknown benchmark profile: "".',
        profile: ''
    },
    {
        config: { profiles: { startup: benchmark } },
        diagnostic: 'Unknown benchmark profile: "constructor".',
        profile: 'constructor'
    },
    {
        config: { profiles: { benchmark: ordinary, startup: benchmark } },
        diagnostic:
            'Profile "benchmark" has testFamily "microtest". Benchmark commands require testFamily "benchmark".',
        profile: 'benchmark'
    },
    {
        config: {
            profiles: { service: { testFamily: 'integration', files: { include: [ 'service.test.ts' ] } } }
        },
        diagnostic:
            'Profile "service" has testFamily "integration". Benchmark commands require testFamily "benchmark".',
        profile: 'service'
    },
    {
        config: { profiles: { benchmark: ordinary } },
        diagnostic: 'No benchmark profiles are configured. Configure a benchmark profile and use --profile.',
        profile: null
    },
    {
        config: { profiles: { zebra: benchmark, alpha: benchmark, benchmark: ordinary } },
        diagnostic: 'Multiple benchmark profiles are configured: alpha, zebra. Use --profile <name>.',
        profile: null
    }
];

type BenchmarkCommandFixture = {
    readonly benchmark: CommandLineBenchmarkCommands;
    readonly commands: readonly RunCommand[];
};

function createCommandFixture(
    loadConfig: ConfigLoader
): BenchmarkCommandFixture {
    const defaultReporter = createNullReporter();
    const orchestrator = createDeterministicRunOrchestrator();
    const commands: RunCommand[] = [];
    const runner = {
        ...orchestrator,
        bench: {
            ...orchestrator.bench,
            async list(command: RunCommand) {
                commands.push(command);
                return await orchestrator.bench.list(command, { timing: null });
            },
            async runWithReporterDelivery(command: RunCommand) {
                commands.push(command);
                return await orchestrator.bench.runWithReporterDelivery(command, { timing: null });
            }
        }
    };

    return {
        commands,
        benchmark: createBenchmarkCommands({
            async createDefaultReporter() {
                return defaultReporter;
            },
            loadConfig,
            orchestrator: runner
        })
    };
}

async function invokeBenchmark(
    commands: CommandLineBenchmarkCommands,
    verb: typeof verbs[number],
    profile: string | null,
    configPath: string | null
): Promise<CommandLineRunnerResult> {
    const request = defaultRunRequest({ paths: [ 'missing.bench.ts' ] });
    const context = { configPath, cwd: configFixtureCwd };

    return verb === 'runBenchmarks'
        ? await commands.runBenchmarks({ ...context, runRequest: { ...request, profile } })
        : await commands.listBenchmarks({
            ...context,
            listRequest: {
                order: 'seeded',
                paths: request.paths,
                profile,
                seed: request.seed,
                selection: request.selection,
                shard: request.shard,
                withLocations: false,
                withOrphans: false
            }
        });
}

export const testNode = suite(
    'benchmark commands',
    verbs.flatMap(function commandTests(verb) {
        return [
            test(`${verb} selects explicit and sole benchmark profiles`, async function (scope) {
                const scenarios: readonly SelectedProfileScenario[] = [
                    { profiles: { startup: benchmark, benchmark: ordinary }, profile: null, selected: 'startup' },
                    { profiles: { startup: benchmark, benchmark: ordinary }, profile: 'startup', selected: 'startup' },
                    { profiles: { startup: benchmark, benchmark }, profile: 'benchmark', selected: 'benchmark' },
                    { profiles: { constructor: benchmark }, profile: 'constructor', selected: 'constructor' },
                    { profiles: { zebra: benchmark, alpha: benchmark }, profile: 'zebra', selected: 'zebra' }
                ];

                for (const scenario of scenarios) {
                    const fixture = createCommandFixture(createSingleConfigModuleLoader(
                        'overkill.config.ts',
                        { config: { profiles: scenario.profiles } }
                    ));
                    const result = await invokeBenchmark(fixture.benchmark, verb, scenario.profile, null);
                    scope.assert.equal(result.exitCode, 0);
                    scope.assert.deepEqual(result.fallbackDiagnostics, []);
                    scope.assert.deepEqual(
                        fixture.commands.map(function selectedProfile(command) {
                            return command.request.profile;
                        }),
                        [ scenario.selected ]
                    );
                    scope.assert.equal(result.runResult === null, verb === 'listBenchmarks');
                    scope.assert.equal(result.stdoutLines.length > 0, verb === 'listBenchmarks');
                }
                return scope.assert.collect();
            }),
            test(`${verb} loads config once and preserves complete policy`, async function (scope) {
                const config = {
                    ...normalizeConfig({ profiles: { startup: benchmark, benchmark: ordinary } }),
                    configPath: null
                };
                const snapshot = {
                    ...normalizeConfig({ profiles: { startup: benchmark, benchmark: ordinary } }),
                    outputRenderer: config.outputRenderer
                };
                const loads: ConfigLoadRequest[] = [];
                const fixture = createCommandFixture(async function loadConfig(request) {
                    loads.push({ configPath: request.configPath, cwd: request.cwd });
                    return config;
                });
                const result = await invokeBenchmark(fixture.benchmark, verb, null, 'custom.config.ts');
                scope.assert.equal(result.exitCode, 0);
                scope.assert.deepEqual(loads, [ { configPath: 'custom.config.ts', cwd: configFixtureCwd } ]);
                scope.assert.deepEqual(config, { ...snapshot, configPath: null });
                scope.assert.equal(Object.isFrozen(config), false);
                return scope.assert.collect();
            }),
            test(`${verb} rejects invalid selections before planning`, async function (scope) {
                for (const scenario of selectionErrors) {
                    const fixture = createCommandFixture(createSingleConfigModuleLoader(
                        'overkill.config.ts',
                        { config: scenario.config }
                    ));
                    const result = await invokeBenchmark(fixture.benchmark, verb, scenario.profile, null);
                    scope.assert.deepEqual(result, {
                        exitCode: 3,
                        fallbackDiagnostics: [ `Overkill argument error: ${scenario.diagnostic}` ],
                        runResult: null,
                        stdoutLines: []
                    });
                    scope.assert.deepEqual(fixture.commands, []);
                }
                return scope.assert.collect();
            }),
            test(`${verb} discovers and loads explicit config paths`, async function (scope) {
                for (const configPath of [ null, 'custom.config.ts' ]) {
                    const fixture = createCommandFixture(createSingleConfigModuleLoader(
                        configPath ?? 'overkill.config.ts',
                        { config: { profiles: { startup: benchmark } } }
                    ));
                    const result = await invokeBenchmark(fixture.benchmark, verb, null, configPath);
                    scope.assert.equal(result.exitCode, 0);
                    scope.assert.equal(fixture.commands.length, 1);
                }
                return scope.assert.collect();
            }),
            test(`${verb} reports malformed policy before profile selection`, async function (scope: TestScope) {
                const fixture = createCommandFixture(createSingleConfigModuleLoader(
                    'overkill.config.ts',
                    { config: { profiles: { startup: { testFamily: 'benchmark' } } } }
                ));
                const result = await invokeBenchmark(fixture.benchmark, verb, 'unknown', null);
                scope.assert.equal(result.exitCode, 3);
                scope.assert.includes(result.fallbackDiagnostics[0] ?? '', 'Overkill configuration error:');
                scope.assert.deepEqual(fixture.commands, []);
                return scope.assert.collect();
            })
        ];
    })
);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
