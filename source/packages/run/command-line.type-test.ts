import { describe, expect, test } from 'tstyche';
import type { Reporter, TestPlan } from '../engine/engine.entry-point.ts';
import {
    RunConfigError,
    type commandLineExitCodes,
    type commandLineRunner,
    type defineConfig,
    type CommandLineExitCode,
    type CommandLineRunner,
    type CommandLineRunnerResult,
    type CommandLineRunTestsRequest,
    type LoadedRunConfig,
    type RunProjectConfig
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
    });

    test('keeps command-line run input explicit', function () {
        expect<keyof CommandLineRunTestsRequest>().type.toBe<'configPath' | 'cwd' | 'request' | 'testPlan'>();
        expect<CommandLineRunTestsRequest['configPath']>().type.toBe<string | null>();
        expect<CommandLineRunTestsRequest['cwd']>().type.toBe<string>();
        expect<CommandLineRunTestsRequest['request']>().type.toBe<RunRequest>();
        expect<CommandLineRunTestsRequest['testPlan']>().type.toBe<TestPlan>();
    });

    test('exposes stable command-line results and exit codes', function () {
        expect<CommandLineRunnerResultKeys>().type.toBe<'exitCode' | 'fallbackDiagnostics' | 'runResult'>();
        expect<CommandLineExitCode>().type.toBe<ExpectedCommandLineExitCode>();
        expect<CommandLineRunnerResult['fallbackDiagnostics']>().type.toBe<readonly string[]>();
    });

    test('exposes typed config helpers', function () {
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<RunProjectConfig['reporters']>().type.toBe<readonly [Reporter, ...Reporter[]] | undefined>();
        expect<LoadedRunConfig['reporters']>().type.toBe<readonly [Reporter, ...Reporter[]] | null>();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });
});
