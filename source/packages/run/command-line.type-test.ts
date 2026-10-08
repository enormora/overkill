import { describe, expect, test } from 'tstyche';
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
    type CommandLineCommand,
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
    type ProjectProfileFiles,
    type ProjectProfileConfig,
    type ProjectBenchmarkProfileConfig,
    type ProjectProfilesConfig,
    type ProjectResourceBudgets
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

describe('@overkill-dev/run/command-line', function () {
    test('exposes an instantiated command-line runner', function () {
        expect<typeof commandLineRunner>().type.toBe<CommandLineRunner>();
        expect<typeof createNodeCommandLineRunner>().type.toBe<
            (options: NodeCommandLineRunnerOptions) => CommandLineRunner
        >();
        expect<typeof commandLineRunner.runTests>().type.toBe<
            (request: CommandLineRunTestsRequest) => Promise<CommandLineRunnerResult>
        >();
        expect<typeof commandLineRunner.listTests>().type.toBe<
            (request: CommandLineListTestsRequest) => Promise<CommandLineRunnerResult>
        >();
        expect<typeof commandLineRunner.replayRun>().type.toBe<CommandLineCommand>();
        expect<typeof commandLineRunner.replayWitness>().type.toBe<CommandLineCommand>();
        expect<typeof commandLineRunner.baseline>().type.toBe<CommandLineBaselineCommands>();
        expect<typeof commandLineRunner.bench>().type.toBe<CommandLineBenchmarkCommands>();
    });

    test('keeps command-line run input explicit', function () {
        expect<keyof CommandLineRunTestsRequest>().type.toBe<'configPath' | 'cwd' | 'runRequest'>();
        expect<CommandLineRunTestsRequest['configPath']>().type.toBe<string | null>();
        expect<CommandLineRunTestsRequest['cwd']>().type.toBe<string>();
        expect<CommandLineRunTestsRequest['runRequest']>().type.toBe<RunRequest>();
        expect<keyof CommandLineCommandContext>().type.toBe<'arguments' | 'configPath' | 'cwd'>();
        expect<CommandLineCommandContext['arguments']>().type.toBe<readonly string[]>();
        expect<CommandLineCommandContext['configPath']>().type.toBe<string | null>();
        expect<CommandLineCommandContext['cwd']>().type.toBe<string>();
        expect<keyof CommandLineListTestsRequest>().type.toBe<'configPath' | 'cwd' | 'listRequest'>();
        expect<CommandLineListTestsRequest['listRequest']>().type.toBe<{
            readonly order: Exclude<RunRequest['order'], 'plan'>;
            readonly paths: readonly string[];
            readonly profile: string;
            readonly seed: RunRequest['seed'];
            readonly selection: RunRequest['selection'];
            readonly shard: RunRequest['shard'];
            readonly withLocations: boolean;
            readonly withOrphans: boolean;
        }>();
    });

    test('exposes stable command-line results and exit codes', function () {
        expect<CommandLineRunnerResultKeys>().type.toBe<
            'exitCode' | 'fallbackDiagnostics' | 'runResult' | 'stdoutLines'
        >();
        expect<CommandLineExitCode>().type.toBe<ExpectedCommandLineExitCode>();
        expect<CommandLineRunnerResult['fallbackDiagnostics']>().type.toBe<readonly string[]>();
        expect<CommandLineRunnerResult['stdoutLines']>().type.toBe<readonly string[]>();
    });

    test('exposes typed config helpers', function () {
        expect<typeof defineConfig>().type.toBe<(config: Config) => Config>();
        expect<Config['outputRenderer']>().type.toBe<DefinedOutputRenderer | undefined>();
        expect<LoadedConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer>();
        expect<Config['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect<LoadedConfig['reporters']>().type.toBe<readonly DefinedReporter[] | null>();
        expect<ProjectResourceBudgets['residentSetBytes']>().type.toBe<number | null | undefined>();
        expect(new ConfigError('Invalid config.')).type.toBe<ConfigError>();
    });

    test('exposes typed runner profiles', function () {
        expect<Config['profiles']>().type.toBe<ProjectProfilesConfig | undefined>();
        expect<ProjectProfilesConfig[string]>().type.toBe<ProjectProfileConfig>();
        expect<ProjectProfileConfig>().type.toBe<
            ProjectBenchmarkProfileConfig | ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig
        >();
        expect<ProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly execution: ProjectMicrotestProfileConfig['execution'];
            readonly testFamily: 'microtest';
        }>();
        expect<ProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly files: ProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
        expect<ProjectProfilesConfig['backend-http']>().type.toBe<ProjectProfileConfig>();
        expect<ProjectMicrotestProfileConfig['files']>().type.toBe<ProjectProfileFiles | undefined>();
        expect<TestProfileConfig['resourceUsage']['measure']>().type.toBe<boolean>();
        expect<LoadedConfig['profiles']['backend-http']['files']>().type.not.toBe<undefined>();
    });

    test('exposes typed profile file discovery', function () {
        expect<ProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFilePatterns>();
        expect<ProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFileSets>();
    });
});
