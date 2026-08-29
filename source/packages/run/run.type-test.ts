import { describe, expect, test } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    OutputRenderer,
    Reporter,
    RunResult
} from '../engine/engine.entry-point.ts';
import {
    RunConfigError,
    RunResolutionError,
    type defineConfig,
    type loadRunConfig,
    type LoadedRunConfig,
    type orchestrator,
    type ResolvedRun,
    type RunCommand,
    type RunConfig,
    type RunConfigLoadRequest,
    type RunEngineSelection,
    type RunExecutionFacts,
    type RunFacts,
    type RunSelection,
    type RunMicrotestProfileConfig,
    type RunOrchestrator,
    type RunProcessModel,
    type RunProfileConfig,
    type RunProfileFiles,
    type RunProjectConfig,
    type RunProjectProfileFiles,
    type RunProjectMicrotestProfileConfig,
    type RunProjectProfileConfig,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunRequest,
    type RunScheduling,
    type SerializedValue
} from './run.entry-point.ts';

type RunRequestKeys = readonly [
    'baselineUpdateMode',
    'capabilityRestrictions',
    'capture',
    'debug',
    'execution',
    'measureResourceUsage',
    'order',
    'paths',
    'profile',
    'resourceBudgetOverrides',
    'resourceUsageSamplingIntervalMilliseconds',
    'seed',
    'selection',
    'shard',
    'verbose'
];

type ExpectedRunRequestKey = RunRequestKeys[number];

describe('@overkill-dev/run', function () {
    test('exposes the typed run command surface', function () {
        expect<keyof RunCommand>().type.toBe<'config' | 'cwd' | 'engine' | 'request'>();
        expect<RunCommand['config']>().type.toBe<RunConfig>();
        expect<RunCommand['cwd']>().type.toBe<string>();
        expect<RunCommand['engine']>().type.toBe<RunEngineSelection>();
        expect<RunCommand['request']>().type.toBe<RunRequest>();
        expect<typeof orchestrator>().type.toBe<RunOrchestrator>();
        expect<typeof orchestrator.resolve>().type.toBe<(command: RunCommand) => Promise<ResolvedRun>>();
        expect<typeof orchestrator.run>().type.toBe<(command: RunCommand) => Promise<RunResult>>();
    });

    test('keeps request fields explicit for the implemented runner slice', function () {
        expect<keyof RunRequest>().type.toBe<ExpectedRunRequestKey>();
        expect<RunRequest['capabilityRestrictions']['mode']>().type.toBe<'disabled' | 'enabled'>();
        expect<RunRequest['execution']['mode']>().type.toBe<'profile-default'>();
        expect<RunRequest['measureResourceUsage']>().type.toBe<boolean | null>();
        expect<RunRequest['profile']>().type.toBe<string>();
        expect<RunRequest['resourceBudgetOverrides']>().type.toBe<RunResourceBudgets | null>();
        expect<RunRequest['order']>().type.toBe<'plan'>();
        expect<RunRequest['selection']>().type.toBe<RunSelection>();
    });

    test('exposes serializable run facts with case metadata', function () {
        expect<keyof RunFacts>().type.toBe<'cases' | 'environment' | 'execution' | 'loader' | 'reproducibility'>();
        expect<RunExecutionFacts['engine']['kind']>().type.toBe<'default' | 'instance' | 'module'>();
        expect<RunExecutionFacts['processModel']>().type.toBe<RunProcessModel>();
        expect<RunExecutionFacts['profile']>().type.toBe<string>();
        expect<RunExecutionFacts['resourceUsagePolicy']>().type.toBe<RunResourceUsagePolicy>();
        expect<RunExecutionFacts['scheduling']>().type.toBe<RunScheduling>();
        expect<RunExecutionFacts['testFamily']>().type.toBe<'microtest'>();
        expect<RunFacts['cases'][number]['metadata']>().type.toBe<SerializedValue>();
        expect<RunFacts['reproducibility']['selection']>().type.toBe<RunSelection>();
        expect<RunFacts>().type.toBeAssignableTo<Readonly<Record<string, unknown>>>();
    });

    test('exposes collection, soft, and hard timeout facts', function () {
        expect<RunExecutionFacts['timeoutPolicy']['collectionMilliseconds']>().type.toBe<number>();
        expect<RunExecutionFacts['timeoutPolicy']['hardMilliseconds']>().type.toBe<number>();
        expect<RunExecutionFacts['timeoutPolicy']['softMilliseconds']>().type.toBe<number>();
    });

    test('exposes config and resolution errors', function () {
        expect<keyof RunConfig>().type.toBe<
            'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
        >();
        expect<RunConfig['outputRenderer']>().type.toBe<OutputRenderer>();
        expect<RunConfig['profiles'][string]>().type.toBe<RunProfileConfig>();
        expect<RunProfileConfig>().type.toBe<RunMicrotestProfileConfig>();
        expect<RunConfig['profiles']['backend-http']>().type.toBe<RunMicrotestProfileConfig>();
        expect<RunConfig['reporters']>().type.toBe<readonly Reporter[]>();
        expect<keyof RunResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
        expect(new RunResolutionError('Unsupported.', undefined, 'unsupported-request')).type.toBe<
            RunResolutionError
        >();
    });

    test('exposes profile file discovery types', function () {
        expect<RunMicrotestProfileConfig['files']>().type.toBe<RunProfileFiles | null>();
        expect<RunProfileFiles['include']>().type.toBe<readonly [string, ...string[]]>();
        expect<RunProjectMicrotestProfileConfig['files']>().type.toBe<RunProjectProfileFiles | undefined>();
        expect<RunProjectProfileFiles['include']>().type.toBe<readonly [string, ...string[]]>();
        expect<RunProjectProfileFiles['exclude']>().type.toBe<readonly string[] | undefined>();
    });

    test('exposes config loading helpers from the main package surface', function () {
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<typeof loadRunConfig>().type.toBe<
            (request: RunConfigLoadRequest) => Promise<LoadedRunConfig>
        >();
        expect<RunProjectConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer | undefined>();
        expect<RunProjectConfig['reporters']>().type.toBe<
            readonly [DefinedReporter, ...DefinedReporter[]] | undefined
        >();
        expect<RunProjectProfileConfig>().type.toBe<RunProjectMicrotestProfileConfig>();
        expect<RunProjectProfileConfig>().type.not.toBeAssignableFrom<{
            readonly execution: RunProjectMicrotestProfileConfig['execution'];
        }>();
        expect<RunProjectProfileConfig>().type.not.toBeAssignableFrom<{ readonly testFamily: 'integration'; }>();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });
});
