import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { normalizeConfig, type Config } from '../packages/run/config.entry-point.ts';
import type { ConfigLoadRequest } from '../config/config.ts';
import { copyConfig } from '../config/snapshot.ts';
import {
    configFixtureCwd,
    createSingleConfigModuleLoader
} from '../test-support/run-config-module-loader.ts';
import { createBenchmarkCommands } from './benchmark-commands.ts';
import type { CommandLineBenchmarkRequest } from './command-line-command.ts';

const benchmark = { testFamily: 'benchmark', files: { include: [ 'missing.bench.ts' ] } } as const;
const ordinary = { testFamily: 'microtest' } as const;
const verbs = [ 'runBenchmarks', 'listBenchmarks' ] as const;
const request: CommandLineBenchmarkRequest = {
    configPath: null,
    cwd: configFixtureCwd,
    paths: [ 'missing.bench.ts' ],
    profile: null
};

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

export const testNode = suite(
    'benchmark command profile selection',
    verbs.flatMap(function benchmarkCommandTests(verb) {
        const command = verb === 'runBenchmarks' ? 'bench run' : 'bench list';

        return [
            test(`${command} selects explicit and sole benchmark profiles`, async function (scope) {
                const scenarios: readonly SelectedProfileScenario[] = [
                    { profiles: { startup: benchmark, benchmark: ordinary }, profile: null, selected: 'startup' },
                    { profiles: { startup: benchmark, benchmark: ordinary }, profile: 'startup', selected: 'startup' },
                    { profiles: { startup: benchmark, benchmark }, profile: 'benchmark', selected: 'benchmark' },
                    { profiles: { constructor: benchmark }, profile: 'constructor', selected: 'constructor' },
                    { profiles: { zebra: benchmark, alpha: benchmark }, profile: 'zebra', selected: 'zebra' }
                ];

                for (const scenario of scenarios) {
                    const commands = createBenchmarkCommands(createSingleConfigModuleLoader(
                        'overkill.config.ts',
                        { config: { profiles: scenario.profiles } }
                    ));
                    const result = await commands[verb]({ ...request, profile: scenario.profile });

                    scope.assert.deepEqual(result, {
                        exitCode: 3,
                        fallbackDiagnostics: [
                            `Overkill argument error: Command "${command}" for profile "${scenario.selected}" ` +
                            'is not implemented yet.'
                        ],
                        runResult: null,
                        stdoutLines: []
                    });
                }

                return scope.assert.collect();
            }),
            test(`${command} loads requested config once and preserves complete policy`, async function (scope) {
                const config = {
                    ...normalizeConfig({ profiles: { startup: benchmark, benchmark: ordinary } }),
                    configPath: null
                };
                const snapshot = copyConfig(config);
                const loads: ConfigLoadRequest[] = [];
                const commands = createBenchmarkCommands(async function loadConfig(input) {
                    loads.push(input);

                    return config;
                });
                await commands[verb]({ ...request, configPath: 'custom.config.ts' });

                scope.assert.deepEqual(loads, [ { configPath: 'custom.config.ts', cwd: configFixtureCwd } ]);
                scope.assert.deepEqual(config, { ...snapshot, configPath: null });
                scope.assert.equal(Object.isFrozen(config), false);
                return scope.assert.collect();
            }),
            test(`${command} rejects unknown, wrong-family, missing, and ambiguous selections`, async function (scope) {
                for (const scenario of selectionErrors) {
                    const commands = createBenchmarkCommands(
                        createSingleConfigModuleLoader('overkill.config.ts', { config: scenario.config })
                    );
                    const result = await commands[verb]({ ...request, profile: scenario.profile });

                    scope.assert.deepEqual(result, {
                        exitCode: 3,
                        fallbackDiagnostics: [ `Overkill argument error: ${scenario.diagnostic}` ],
                        runResult: null,
                        stdoutLines: []
                    });
                }

                return scope.assert.collect();
            }),
            test(`${command} discovers config and loads explicit config paths`, async function (scope) {
                for (const configPath of [ null, 'custom.config.ts' ]) {
                    const commands = createBenchmarkCommands(createSingleConfigModuleLoader(
                        configPath ?? 'overkill.config.ts',
                        { config: { profiles: { startup: benchmark } } }
                    ));
                    const result = await commands[verb]({ ...request, configPath });

                    scope.assert.deepEqual(result.fallbackDiagnostics, [
                        `Overkill argument error: Command "${command}" for profile "startup" is not implemented yet.`
                    ]);
                    scope.assert.equal(result.exitCode, 3);
                }

                return scope.assert.collect();
            }),
            test(
                `${command} reports config failures before unknown profile selection`,
                async function (scope: TestScope) {
                    const commands = createBenchmarkCommands(createSingleConfigModuleLoader(
                        'overkill.config.ts',
                        { config: { profiles: { startup: { testFamily: 'benchmark' } } } }
                    ));
                    const result = await commands[verb]({ ...request, profile: 'unknown' });

                    scope.assert.equal(result.exitCode, 3);
                    scope.assert.includes(result.fallbackDiagnostics[0] ?? '', 'Overkill configuration error:');
                    scope.assert.deepEqual({ runResult: result.runResult, stdoutLines: result.stdoutLines }, {
                        runResult: null,
                        stdoutLines: []
                    });

                    return scope.assert.collect();
                }
            )
        ];
    })
);

const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
