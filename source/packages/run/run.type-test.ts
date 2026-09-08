import { describe, expect, test } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
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
    type RunIfMain,
    type RunIfMainOptions,
    type RunIfMainRootOptions,
    type runIfMain,
    type RunIntegrationProfileConfig,
    type RunSelection,
    type RunMicrotestProfileConfig,
    type RunOrchestrator,
    type RunProcessModel,
    type RunProfileConfig,
    type RunProfileFiles,
    type RunProjectConfig,
    type RunProjectIntegrationProfileConfig,
    type RunProjectProfileFiles,
    type RunProjectMicrotestProfileConfig,
    type RunProjectProfileConfig,
    type RunResourceBudgets,
    type RunResourceUsagePolicy,
    type RunRequest,
    type RunScheduling,
    type RunTestFamily,
    type SerializedValue
} from './run.entry-point.ts';

declare const outputRenderer: DefinedOutputRenderer;
declare const reporter: DefinedReporter;
declare const testNode: Parameters<RunIfMain>[1];

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
type RuntimeProfileFilePatterns = {
    readonly exclude: readonly string[];
    readonly include: readonly [string, ...readonly string[]];
};
type RuntimeProfileFileSets = {
    readonly sets: Readonly<
        Record<string, {
            readonly exclude: readonly string[];
            readonly include: readonly [string, ...readonly string[]];
        }>
    >;
};
type MixedRuntimeProfileFiles = RuntimeProfileFilePatterns & RuntimeProfileFileSets;
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

    test('exposes the direct-file execution companion', function () {
        expect<typeof runIfMain>().type.toBe<RunIfMain>();
        expect<RunIfMainOptions>().type.toBe<{
            readonly outputRenderer?: DefinedOutputRenderer;
            readonly reporters?: readonly DefinedReporter[];
            readonly root?: RunIfMainRootOptions;
        }>();
        expect<RunIfMainRootOptions>().type.toBe<{
            readonly metadata: Parameters<RunIfMain>[1]['metadata'];
            readonly title: string;
        }>();
        expect<typeof runIfMain>().type.toBeCallableWith(import.meta, testNode);
        expect<typeof runIfMain>().type.toBeCallableWith(import.meta, testNode, {
            outputRenderer,
            reporters: [ reporter ],
            root: {
                metadata: {},
                title: 'root'
            }
        });
        expect<typeof runIfMain>().type.not.toBeCallableWith(import.meta, testNode, { runFacts: {} });
        expect<typeof runIfMain>().type.not.toBeCallableWith(import.meta, testNode, { profile: 'microtest' });
        expect<typeof runIfMain>().type.not.toBeCallableWith(import.meta, testNode, { cwd: 'project' });
    });

    test('keeps request fields explicit for the implemented runner slice', function () {
        expect<keyof RunRequest>().type.toBe<ExpectedRunRequestKey>();
        expect<RunRequest['capabilityRestrictions']['mode']>().type.toBe<'disabled' | 'enabled'>();
        expect<RunRequest['execution']['mode']>().type.toBe<'profile-default'>();
        expect<RunRequest['measureResourceUsage']>().type.toBe<boolean | null>();
        expect<RunRequest['profile']>().type.toBe<string>();
        expect<RunRequest['resourceBudgetOverrides']>().type.toBe<RunResourceBudgets | null>();
        expect<Pick<RunRequest, 'capture' | 'order'>>().type.toBe<{
            readonly capture: 'buffered' | 'live';
            readonly order: 'plan';
        }>();
        expect<RunRequest['selection']>().type.toBe<RunSelection>();
    });

    test('exposes serializable run facts with case metadata', function () {
        expect<keyof RunFacts>().type.toBe<'cases' | 'environment' | 'execution' | 'loader' | 'reproducibility'>();
        expect<RunExecutionFacts['engine']['kind']>().type.toBe<'default' | 'instance' | 'module'>();
        expect<Pick<RunExecutionFacts, 'capture' | 'processModel'>>().type.toBe<{
            readonly capture: 'buffered' | 'live';
            readonly processModel: RunProcessModel;
        }>();
        expect<RunExecutionFacts['profile']>().type.toBe<string>();
        expect<RunExecutionFacts['resourceUsagePolicy']>().type.toBe<RunResourceUsagePolicy>();
        expect<RunExecutionFacts['scheduling']>().type.toBe<RunScheduling>();
        expect<RunExecutionFacts['testFamily']>().type.toBe<RunTestFamily>();
        expect<RunFacts['cases'][number]['metadata']>().type.toBe<SerializedValue>();
        expect<RunFacts['reproducibility']['selection']>().type.toBe<RunSelection>();
        expect<RunFacts>().type.toBeAssignableTo<Readonly<Record<string, unknown>>>();
    });

    test('exposes case file set facts', function () {
        expect<RunFacts['cases'][number]['fileSet']>().type.toBe<string | null>();
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
        expect<RunConfig['outputRenderer']>().type.toBe<DefinedOutputRenderer>();
        expect<RunConfig['profiles'][string]>().type.toBe<RunProfileConfig>();
        expect<RunProfileConfig>().type.toBe<RunIntegrationProfileConfig | RunMicrotestProfileConfig>();
        expect<RunConfig['profiles']['backend-http']>().type.toBe<RunProfileConfig>();
        expect<RunConfig['reporters']>().type.toBe<readonly DefinedReporter[]>();
        expect<keyof RunResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
        expect(new RunResolutionError('Unsupported.', undefined, 'unsupported-request')).type.toBe<
            RunResolutionError
        >();
    });

    test('exposes profile file discovery types', function () {
        expect<RunMicrotestProfileConfig['files']>().type.toBe<RunProfileFiles | null>();
        expect<RunIntegrationProfileConfig['files']>().type.toBe<RunProfileFiles>();
        expect<RunProfileFiles>().type.toBeAssignableFrom<RuntimeProfileFilePatterns>();
        expect<RunProfileFiles>().type.toBeAssignableFrom<RuntimeProfileFileSets>();
        expect<RunProfileFiles>().type.not.toBeAssignableFrom<MixedRuntimeProfileFiles>();
        expect<RunProjectMicrotestProfileConfig['files']>().type.toBe<RunProjectProfileFiles | undefined>();
        expect<RunProjectIntegrationProfileConfig['files']>().type.toBe<RunProjectProfileFiles>();
        expect<RunProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFilePatterns>();
        expect<RunProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFileSets>();
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
        expect<RunProjectProfileConfig>().type.toBe<
            RunProjectIntegrationProfileConfig | RunProjectMicrotestProfileConfig
        >();
        expect<RunProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly execution: RunProjectMicrotestProfileConfig['execution'];
            readonly testFamily: 'microtest';
        }>();
        expect<RunProjectProfileConfig>().type.toBeAssignableFrom<{
            readonly files: RunProjectProfileFiles;
            readonly testFamily: 'integration';
        }>();
        expect(new RunConfigError('Invalid config.')).type.toBe<RunConfigError>();
    });
});
