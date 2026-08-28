import { describe, expect, test } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    OutputRenderer,
    Reporter
} from '../engine/engine.entry-point.ts';
import {
    RunConfigError,
    type commandLineExitCodes,
    type commandLineRunner,
    type defineConfig,
    type CommandLineBaselineCommands,
    type CommandLineBenchmarkCommands,
    type CommandLineCommand,
    type CommandLineCommandContext,
    type CommandLineExitCode,
    type CommandLineListTestsRequest,
    type CommandLineRunner,
    type CommandLineRunnerResult,
    type CommandLineRunTestsRequest,
    type LoadedRunConfig,
    type RunProjectConfig,
    type RunProjectMicrotestProfileConfig,
    type RunProjectProfileFiles,
    type RunProjectProfileConfig,
    type RunProjectProfilesConfig,
    type RunProjectResourceBudgets
} from './command-line.entry-point.ts';
import type { RunRequest } from './run.entry-point.ts';

type CommandLineRunnerResultKeys = keyof CommandLineRunnerResult;
type ExpectedCommandLineExitCode = (typeof commandLineExitCodes)[keyof typeof commandLineExitCodes];

describe('@overkill-dev/run/command-line', function () {
    test('exposes an instantiated command-line runner', function () {
        expect<typeof commandLineRunner>().type.toBe<CommandLineRunner>();
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
            readonly paths: readonly string[];
            readonly profile: string;
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
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<RunProjectConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer | undefined>();
        expect<LoadedRunConfig['outputRenderer']>().type.toBe<OutputRenderer>();
        expect<RunProjectConfig['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect<LoadedRunConfig['reporters']>().type.toBe<readonly [Reporter, ...Reporter[]] | null>();
        expect<RunProjectResourceBudgets['residentSetBytes']>().type.toBe<number | null | undefined>();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });

    test('exposes typed runner profiles', function () {
        expect<RunProjectConfig['profiles']>().type.toBe<RunProjectProfilesConfig | undefined>();
        expect<RunProjectProfilesConfig[string]>().type.toBe<RunProjectProfileConfig>();
        expect<RunProjectProfileConfig>().type.toBe<RunProjectMicrotestProfileConfig>();
        expect<RunProjectProfileConfig>().type.not.toBeAssignableFrom<{
            readonly execution: RunProjectMicrotestProfileConfig['execution'];
        }>();
        expect<RunProjectProfilesConfig['backend-http']>().type.toBe<RunProjectMicrotestProfileConfig>();
        expect<RunProjectMicrotestProfileConfig['files']>().type.toBe<RunProjectProfileFiles | undefined>();
        expect<RunProjectProfileFiles['include']>().type.toBe<readonly [string, ...string[]]>();
        expect<LoadedRunConfig['profiles']['backend-http']['resourceUsage']['measure']>().type.toBe<boolean>();
        expect<LoadedRunConfig['profiles']['backend-http']['files']>().type.not.toBe<undefined>();
    });
});
