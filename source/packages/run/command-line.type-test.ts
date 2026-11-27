import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { ProjectDefinedFamilyProfile } from '../../config/schema.ts';
import type { TestProfileConfig } from '../../config/types.ts';
import type {
    DefinedOutputRenderer,
    DefinedReporter
} from '../engine/engine.entry-point.ts';
import {
    ConfigError,
    type commandLineExitCodes,
    type commandLineRunner,
    type createNodeCommandLineRunner,
    type defineConfig,
    type CommandLineBaselineCommands,
    type CommandLineBenchmarkCommands,
    type CommandLineBenchmarkRunRequest,
    type CommandLineBenchmarkListRequest,
    type CommandLineCommand,
    type CommandLineWitnessReplayRequest,
    type CommandLineCommandContext,
    type CommandLineExitCode,
    type CommandLineListTestsRequest,
    type NodeCommandLineRunnerOptions,
    type CommandLineRunner,
    type CommandLineRunnerResult,
    type CommandLineRunTestsRequest,
    type LoadedConfig,
    type Config,
    type ProjectIntegrationProfileConfig,
    type ProjectMicrotestProfileConfig,
    type ProjectPropertyProfileConfig,
    type ProjectProfileFiles,
    type ProjectProfileConfig,
    type ProjectBenchmarkProfileConfig,
    type ProjectProfilesConfig,
    type ProjectProcessBudgets
} from './command-line.entry-point.ts';
import type { RunRequest } from './run.entry-point.ts';

type CommandLineRunnerResultKeys = keyof CommandLineRunnerResult;
type ExpectedCommandLineExitCode = (typeof commandLineExitCodes)[keyof typeof commandLineExitCodes];
type ProjectProfileFilePatterns = {
    readonly exclude?: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};
type ProjectProfileFileSets = {
    readonly sets: Readonly<
        Record<string, {
            readonly exclude?: readonly string[];
            readonly include: readonly [string, ...readonly string[]];
        }>
    >;
};

type OrdinaryProjectProfile = ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig;

declare const defineConfigUnderTest: typeof defineConfig;

export const testNode = suite('@overkill-dev/run/command-line', [
    suite('exposes an instantiated command-line runner', [
        test('types runner dependencies', function (typeScope) {
            typeScope.assert(sameType<IsEqual<typeof commandLineRunner, CommandLineRunner>, true>());
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof createNodeCommandLineRunner,
                        (options: NodeCommandLineRunnerOptions) => CommandLineRunner
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.runTests,
                        (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.listTests,
                        (request: CommandLineListTestsRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            typeScope.assert(sameType<IsEqual<typeof commandLineRunner.replayRun, CommandLineCommand>, true>());
            return typeScope.assert.collect();
        }),
        test('types runner command execution', function (typeScope) {
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.replayWitness,
                        (request: CommandLineWitnessReplayRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            typeScope.assert(sameType<IsEqual<typeof commandLineRunner.baseline, CommandLineBaselineCommands>, true>());
            typeScope.assert(sameType<IsEqual<typeof commandLineRunner.bench, CommandLineBenchmarkCommands>, true>());
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.bench.runBenchmarks,
                        (request: CommandLineBenchmarkRunRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.bench.listBenchmarks,
                        (request: CommandLineBenchmarkListRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('keeps command-line run input explicit', [
        test('types recording and profile input', function (typeScope) {
            typeScope.assert(sameType<keyof CommandLineRunTestsRequest, 'configPath' | 'cwd' | 'runRequest'>());
            typeScope.assert(sameType<CommandLineRunTestsRequest['configPath'], string | null>());
            typeScope.assert(sameType<CommandLineRunTestsRequest['cwd'], string>());
            typeScope.assert(sameType<CommandLineRunTestsRequest['runRequest'], RunRequest>());
            typeScope.assert(sameType<keyof CommandLineCommandContext, 'arguments' | 'configPath' | 'cwd'>());
            return typeScope.assert.collect();
        }),
        test('types selection and execution input', function (typeScope) {
            typeScope.assert(sameType<CommandLineCommandContext['arguments'], readonly string[]>());
            typeScope.assert(sameType<CommandLineCommandContext['configPath'], string | null>());
            typeScope.assert(sameType<CommandLineCommandContext['cwd'], string>());
            typeScope.assert(sameType<keyof CommandLineListTestsRequest, 'configPath' | 'cwd' | 'listRequest'>());
            typeScope.assert(sameType<CommandLineListTestsRequest['listRequest'], {
                readonly lastFailed: boolean;
                readonly order: Exclude<RunRequest['order'], 'plan'>;
                readonly paths: readonly string[];
                readonly profile: string;
                readonly seed: RunRequest['seed'];
                readonly selection: RunRequest['selection'];
                readonly shard: RunRequest['shard'];
                readonly withLocations: boolean;
                readonly withOrphans: boolean;
            }>());
            return typeScope.assert.collect();
        })
    ]),
    test('exposes stable command-line results and exit codes', function (typeScope) {
        typeScope.assert(
            sameType<CommandLineRunnerResultKeys, 'exitCode' | 'fallbackDiagnostics' | 'runResult' | 'stdoutLines'>()
        );
        typeScope.assert(sameType<CommandLineExitCode, ExpectedCommandLineExitCode>());
        typeScope.assert(sameType<CommandLineRunnerResult['fallbackDiagnostics'], readonly string[]>());
        typeScope.assert(sameType<CommandLineRunnerResult['stdoutLines'], readonly string[]>());
        return typeScope.assert.collect();
    }),
    test('requires benchmark run and list intent with nullable profile selection', function (typeScope) {
        typeScope.assert(sameType<keyof CommandLineBenchmarkRunRequest, 'configPath' | 'cwd' | 'runRequest'>());
        typeScope.assert(sameType<keyof CommandLineBenchmarkListRequest, 'configPath' | 'cwd' | 'listRequest'>());
        typeScope.assert(sameType<CommandLineBenchmarkRunRequest['runRequest']['profile'], string | null>());
        typeScope.assert(sameType<CommandLineBenchmarkListRequest['listRequest']['profile'], string | null>());
        typeScope.assert(assignableFrom.not<CommandLineBenchmarkRunRequest, CommandLineCommandContext>());
        return typeScope.assert.collect();
    }),
    test('exposes typed config helpers', function (typeScope) {
        typeScope.assert(acceptsCall, () => defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } }));
        typeScope.assert(sameType<Config['outputRenderer'], DefinedOutputRenderer | undefined>());
        typeScope.assert(sameType<LoadedConfig['outputRenderer'], DefinedOutputRenderer>());
        typeScope.assert(
            sameType<IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>, true>()
        );
        typeScope.assert(sameType<IsEqual<LoadedConfig['reporters'], readonly DefinedReporter[] | null>, true>());
        typeScope.assert(sameType<ProjectProcessBudgets['residentSetBytes'], number | null | undefined>());
        typeScope.assert(sameType.withActual<ConfigError>(), new ConfigError('Invalid config.'));
        return typeScope.assert.collect();
    }),
    suite('exposes typed runner profiles', [
        test('types profile definitions', function (typeScope) {
            typeScope.assert(sameType<IsEqual<Config['profiles'], ProjectProfilesConfig | undefined>, true>());
            typeScope.assert(sameType<IsEqual<ProjectProfilesConfig[string], ProjectProfileConfig>, true>());
            typeScope.assert(
                sameType<
                    IsEqual<
                        Exclude<ProjectProfileConfig, ProjectPropertyProfileConfig>,
                        OrdinaryProjectProfile | ProjectBenchmarkProfileConfig | ProjectDefinedFamilyProfile
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    Extract<ProjectProfileConfig, { readonly testFamily: 'property'; }>,
                    ProjectPropertyProfileConfig
                >()
            );
            typeScope.assert(sameType<
                [{
                    readonly execution: ProjectMicrotestProfileConfig['execution'];
                    readonly testFamily: 'microtest';
                }] extends [ProjectProfileConfig] ? true : false,
                true
            >());
            return typeScope.assert.collect();
        }),
        test('types normalized profiles', function (typeScope) {
            typeScope.assert(sameType<
                [{
                    readonly files: ProjectProfileFiles;
                    readonly testFamily: 'integration';
                }] extends [ProjectProfileConfig] ? true : false,
                true
            >());
            typeScope.assert(sameType<IsEqual<ProjectProfilesConfig['backend-http'], ProjectProfileConfig>, true>());
            typeScope.assert(sameType<ProjectMicrotestProfileConfig['files'], ProjectProfileFiles | undefined>());
            typeScope.assert(sameType<TestProfileConfig['processUsage']['measure'], boolean>());
            typeScope.assert(sameType.not<LoadedConfig['profiles']['backend-http']['files'], undefined>());
            return typeScope.assert.collect();
        })
    ]),
    test('exposes typed profile file discovery', function (typeScope) {
        typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFilePatterns>());
        typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFileSets>());
        return typeScope.assert.collect();
    })
]);
