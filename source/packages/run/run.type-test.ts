import { describe, expect, test } from 'tstyche';
import type { Engine, OutputRenderer, Reporter, RunResult } from '../engine/engine.entry-point.ts';
import {
    RunResolutionError,
    type orchestrator,
    type ResolvedRun,
    type RunCommand,
    type RunConfig,
    type RunExecutionFacts,
    type RunFacts,
    type RunMicrotestProfileConfig,
    type RunOrchestrator,
    type RunProcessModel,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunRequest,
    type RunScheduling,
    type SerializedValue
} from './run.entry-point.ts';

type RunRequestKeys = readonly [
    'baselineUpdateMode',
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
        expect<RunCommand['engine']>().type.toBe<Engine | null>();
        expect<RunCommand['request']>().type.toBe<RunRequest>();
        expect<typeof orchestrator>().type.toBe<RunOrchestrator>();
        expect<typeof orchestrator.resolve>().type.toBe<(command: RunCommand) => Promise<ResolvedRun>>();
        expect<typeof orchestrator.run>().type.toBe<(command: RunCommand) => Promise<RunResult>>();
    });

    test('keeps request fields explicit for the implemented runner slice', function () {
        expect<keyof RunRequest>().type.toBe<ExpectedRunRequestKey>();
        expect<RunRequest['execution']['mode']>().type.toBe<'profile-default'>();
        expect<RunRequest['measureResourceUsage']>().type.toBe<boolean | null>();
        expect<RunRequest['resourceBudgetOverrides']>().type.toBe<RunResourceBudgets | null>();
        expect<RunRequest['order']>().type.toBe<'plan'>();
    });

    test('exposes serializable run facts with case metadata', function () {
        expect<keyof RunFacts>().type.toBe<'cases' | 'environment' | 'execution' | 'loader' | 'reproducibility'>();
        expect<RunExecutionFacts['processModel']>().type.toBe<RunProcessModel>();
        expect<RunExecutionFacts['resourceUsagePolicy']>().type.toBe<RunResourceUsagePolicy>();
        expect<RunExecutionFacts['scheduling']>().type.toBe<RunScheduling>();
        expect<RunExecutionFacts['testFamily']>().type.toBe<'microtest'>();
        expect<RunExecutionFacts['timeoutPolicy']['hardMilliseconds']>().type.toBe<number>();
        expect<RunFacts['cases'][number]['metadata']>().type.toBe<SerializedValue>();
        expect<RunFacts>().type.toBeAssignableTo<Readonly<Record<string, unknown>>>();
    });

    test('exposes config and resolution errors', function () {
        expect<keyof RunConfig>().type.toBe<
            'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
        >();
        expect<RunConfig['outputRenderer']>().type.toBe<OutputRenderer>();
        expect<RunConfig['profiles']['microtest']>().type.toBe<RunMicrotestProfileConfig>();
        expect<RunConfig['reporters']>().type.toBe<readonly Reporter[]>();
        expect<keyof RunResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
        expect(new RunResolutionError('Unsupported.', undefined, 'unsupported-request')).type.toBe<
            RunResolutionError
        >();
    });
});
