import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, sameType } from '@overkill-dev/type-test';
import type { ProjectDefinedFamilyProfile } from '../../config/schema.ts';
import type { TestProfileConfig } from '../../config/types.ts';
import type {
    DefinedOutputRenderer,
    DefinedReporter
} from '../engine/engine.entry-point.ts';
import { type IsAssignable, isEqualTo } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Command-line parsing and profile selection', [
    suite('exposes an instantiated command-line runner', [
        test('types runner dependencies', function (scope) {
            scope.assert(sameType<IsEqual<typeof commandLineRunner, CommandLineRunner>, true>());
            scope.assert(
                sameType<
                    IsEqual<
                        typeof createNodeCommandLineRunner,
                        (options: NodeCommandLineRunnerOptions) => CommandLineRunner
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.runTests,
                        (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.listTests,
                        (request: CommandLineListTestsRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            scope.assert(sameType<IsEqual<typeof commandLineRunner.replayRun, CommandLineCommand>, true>());
            return scope.assert.collect();
        }),
        test('types runner command execution', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.replayWitness,
                        (request: CommandLineWitnessReplayRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            scope.assert(sameType<IsEqual<typeof commandLineRunner.baseline, CommandLineBaselineCommands>, true>());
            scope.assert(sameType<IsEqual<typeof commandLineRunner.bench, CommandLineBenchmarkCommands>, true>());
            scope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.bench.runBenchmarks,
                        (request: CommandLineBenchmarkRunRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        typeof commandLineRunner.bench.listBenchmarks,
                        (request: CommandLineBenchmarkListRequest) => Promise<CommandLineRunnerResult>
                    >,
                    true
                >()
            );
            return scope.assert.collect();
        })
    ]),
    suite('keeps command-line run input explicit', [
        test('types recording and profile input', function (scope) {
            scope.assert(sameType<keyof CommandLineRunTestsRequest, 'configPath' | 'cwd' | 'runRequest'>());
            scope.assert(sameType<CommandLineRunTestsRequest['configPath'], string | null>());
            scope.assert(sameType<CommandLineRunTestsRequest['cwd'], string>());
            scope.assert(sameType<IsEqual<CommandLineRunTestsRequest['runRequest'], RunRequest>, true>());
            scope.assert(sameType<keyof CommandLineCommandContext, 'arguments' | 'configPath' | 'cwd'>());
            return scope.assert.collect();
        }),
        test('types selection and execution input', function (scope) {
            scope.assert(sameType<IsEqual<CommandLineCommandContext['arguments'], readonly string[]>, true>());
            scope.assert(sameType<CommandLineCommandContext['configPath'], string | null>());
            scope.assert(sameType<CommandLineCommandContext['cwd'], string>());
            scope.assert(sameType<keyof CommandLineListTestsRequest, 'configPath' | 'cwd' | 'listRequest'>());
            scope.assert(sameType<
                IsEqual<CommandLineListTestsRequest['listRequest'], {
                    readonly lastFailed: boolean;
                    readonly order: Exclude<RunRequest['order'], 'plan'>;
                    readonly paths: readonly string[];
                    readonly profile: string;
                    readonly seed: RunRequest['seed'];
                    readonly selection: RunRequest['selection'];
                    readonly shard: RunRequest['shard'];
                    readonly withLocations: boolean;
                    readonly withOrphans: boolean;
                }>,
                true
            >());
            return scope.assert.collect();
        })
    ]),
    test('exposes stable command-line results and exit codes', function (scope) {
        scope.assert(
            sameType<CommandLineRunnerResultKeys, 'exitCode' | 'fallbackDiagnostics' | 'runResult' | 'stdoutLines'>()
        );
        scope.assert(sameType<IsEqual<CommandLineExitCode, ExpectedCommandLineExitCode>, true>());
        scope.assert(sameType<IsEqual<CommandLineRunnerResult['fallbackDiagnostics'], readonly string[]>, true>());
        scope.assert(sameType<IsEqual<CommandLineRunnerResult['stdoutLines'], readonly string[]>, true>());
        return scope.assert.collect();
    }),
    test('requires benchmark run and list intent with nullable profile selection', function (scope) {
        scope.assert(sameType<keyof CommandLineBenchmarkRunRequest, 'configPath' | 'cwd' | 'runRequest'>());
        scope.assert(sameType<keyof CommandLineBenchmarkListRequest, 'configPath' | 'cwd' | 'listRequest'>());
        scope.assert(sameType<CommandLineBenchmarkRunRequest['runRequest']['profile'], string | null>());
        scope.assert(sameType<CommandLineBenchmarkListRequest['listRequest']['profile'], string | null>());
        scope.assert(sameType<IsAssignable<CommandLineCommandContext, CommandLineBenchmarkRunRequest>, false>());
        return scope.assert.collect();
    }),
    test('exposes typed config helpers', function (scope) {
        scope.assert(acceptsCall, function () {
            return defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } });
        });
        scope.assert(sameType<IsEqual<Config['outputRenderer'], DefinedOutputRenderer | undefined>, true>());
        scope.assert(sameType<IsEqual<LoadedConfig['outputRenderer'], DefinedOutputRenderer>, true>());
        scope.assert(
            sameType<IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>, true>()
        );
        scope.assert(sameType<IsEqual<LoadedConfig['reporters'], readonly DefinedReporter[] | null>, true>());
        scope.assert(sameType<ProjectProcessBudgets['residentSetBytes'], number | null | undefined>());
        scope.assert(sameType.withActual<true>(), isEqualTo<ConfigError>()(new ConfigError('Invalid config.')));
        return scope.assert.collect();
    }),
    suite('exposes typed runner profiles', [
        test('types profile definitions', function (scope) {
            scope.assert(sameType<IsEqual<Config['profiles'], ProjectProfilesConfig | undefined>, true>());
            scope.assert(sameType<IsEqual<ProjectProfilesConfig[string], ProjectProfileConfig>, true>());
            scope.assert(
                sameType<
                    IsEqual<
                        Exclude<ProjectProfileConfig, ProjectPropertyProfileConfig>,
                        OrdinaryProjectProfile | ProjectBenchmarkProfileConfig | ProjectDefinedFamilyProfile
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        Extract<ProjectProfileConfig, { readonly testFamily: 'property'; }>,
                        ProjectPropertyProfileConfig
                    >,
                    true
                >()
            );
            scope.assert(sameType<
                [{
                    readonly execution: ProjectMicrotestProfileConfig['execution'];
                    readonly testFamily: 'microtest';
                }] extends [ProjectProfileConfig] ? true : false,
                true
            >());
            return scope.assert.collect();
        }),
        test('types normalized profiles', function (scope) {
            scope.assert(sameType<
                [{
                    readonly files: ProjectProfileFiles;
                    readonly testFamily: 'integration';
                }] extends [ProjectProfileConfig] ? true : false,
                true
            >());
            scope.assert(sameType<IsEqual<ProjectProfilesConfig['backend-http'], ProjectProfileConfig>, true>());
            scope.assert(
                sameType<IsEqual<ProjectMicrotestProfileConfig['files'], ProjectProfileFiles | undefined>, true>()
            );
            scope.assert(sameType<TestProfileConfig['processUsage']['measure'], boolean>());
            scope.assert(sameType.not<LoadedConfig['profiles']['backend-http']['files'], undefined>());
            return scope.assert.collect();
        })
    ]),
    test('exposes typed profile file discovery', function (scope) {
        scope.assert(sameType<IsAssignable<ProjectProfileFilePatterns, ProjectProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<ProjectProfileFileSets, ProjectProfileFiles>, true>());
        return scope.assert.collect();
    })
]);
