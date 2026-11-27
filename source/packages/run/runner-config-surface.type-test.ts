import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type { ProjectDefinedFamilyProfile } from '../../config/schema.ts';
import type {
    AttachmentLimits,
    FailureArtifactPolicy,
    DefinedOutputRenderer,
    DefinedReporter
} from '../engine/engine.entry-point.ts';
import type { OrdinaryBaselinePolicy } from './config.entry-point.ts';
import {
    ConfigError,
    RunResolutionError,
    type TestProfileConfig,
    type defineConfig,
    type loadConfig,
    type LoadedConfig,
    type NormalizedConfig,
    type ConfigLoadRequest,
    type RunExecutionFacts,
    type RunExecutionPlanError,
    type RunExecutionPlanConflict,
    type IntegrationProfileConfig,
    type MaxConcurrency,
    type MicrotestProfileConfig,
    type PropertyProfileConfig,
    type ProfileConfig,
    type BenchmarkProfileConfig,
    type DefinedFamilyProfile,
    type ProfileFiles,
    type Config,
    type ProjectIntegrationProfileConfig,
    type ProjectProfileFiles,
    type ProjectMicrotestProfileConfig,
    type ProjectPropertyProfileConfig,
    type ProjectProfileConfig,
    type ProjectBenchmarkProfileConfig,
    type ProcessBudgets,
    type ProcessUsagePolicy,
    type ProjectTimingProfilePolicy,
    type TimingCollectionMode,
    type TimingProfilePolicy
} from './run.entry-point.ts';

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

type OrdinaryProfile = IntegrationProfileConfig | MicrotestProfileConfig | PropertyProfileConfig;
type OrdinaryProjectProfile = ProjectIntegrationProfileConfig | ProjectMicrotestProfileConfig;

declare const defineConfigUnderTest: typeof defineConfig;

export const testNode = suite('@overkill-dev/run config', [
    test('exposes collection, soft, and hard timeout facts', function (typeScope) {
        typeScope.assert(sameType<RunExecutionFacts['timeoutPolicy']['collectionMilliseconds'], number>());
        typeScope.assert(sameType<RunExecutionFacts['timeoutPolicy']['hardMilliseconds'], number>());
        typeScope.assert(sameType<RunExecutionFacts['timeoutPolicy']['softMilliseconds'], number>());
        return typeScope.assert.collect();
    }),
    test('exposes config and resolution errors', function (typeScope) {
        typeScope.assert(
            sameType<
                keyof NormalizedConfig,
                'history' | 'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
            >()
        );
        typeScope.assert(sameType<NormalizedConfig['outputRenderer'], DefinedOutputRenderer>());
        typeScope.assert(sameType<IsEqual<NormalizedConfig['profiles'][string], ProfileConfig>, true>());
        typeScope.assert(
            sameType<
                IsEqual<ProfileConfig, BenchmarkProfileConfig | DefinedFamilyProfile | OrdinaryProfile>,
                true
            >()
        );
        typeScope.assert(sameType<IsEqual<NormalizedConfig['profiles']['backend-http'], ProfileConfig>, true>());
        typeScope.assert(
            sameType<IsEqual<NormalizedConfig['reporters'], readonly DefinedReporter[] | null>, true>()
        );
        typeScope.assert(sameType<TestProfileConfig['timings'], TimingProfilePolicy>());
        typeScope.assert(sameType<TimingProfilePolicy, { readonly collection: TimingCollectionMode; }>());
        typeScope.assert(sameType<ProjectTimingProfilePolicy, { readonly collection: TimingCollectionMode; }>());
        return typeScope.assert.collect();
    }),
    test('exposes run process budget and resolution error types', function (typeScope) {
        typeScope.assert(
            sameType<
                keyof ProcessBudgets,
                [
                    'activeResourceCount',
                    'javaScriptEngineHeapBytes',
                    'residentSetBytes',
                    'residentSetGrowthBytesPerSecond'
                ][number]
            >()
        );
        typeScope.assert(
            sameType.withActual<RunResolutionError>(),
            new RunResolutionError('Unsupported.', undefined, 'unsupported-request')
        );
        typeScope.assert(
            sameType<
                ReturnType<RunExecutionPlanError['conflicts']>,
                readonly [RunExecutionPlanConflict, ...readonly RunExecutionPlanConflict[]]
            >()
        );
        return typeScope.assert.collect();
    }),
    test('exposes profile file discovery types', function (typeScope) {
        typeScope.assert(sameType<MicrotestProfileConfig['files'], ProfileFiles | null>());
        typeScope.assert(sameType<IntegrationProfileConfig['files'], ProfileFiles>());
        typeScope.assert(assignableFrom<ProfileFiles, RuntimeProfileFilePatterns>());
        typeScope.assert(assignableFrom<ProfileFiles, RuntimeProfileFileSets>());
        typeScope.assert(assignableFrom.not<ProfileFiles, MixedRuntimeProfileFiles>());
        typeScope.assert(sameType<ProjectMicrotestProfileConfig['files'], ProjectProfileFiles | undefined>());
        typeScope.assert(sameType<ProjectIntegrationProfileConfig['files'], ProjectProfileFiles>());
        typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFilePatterns>());
        typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFileSets>());
        return typeScope.assert.collect();
    }),
    test('exposes property profile config types', function (typeScope) {
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
        return typeScope.assert.collect();
    }),
    test('exposes config loading helpers from the main package surface', function (typeScope) {
        typeScope.assert(
            acceptsCall,
            () => defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } })
        );
        typeScope.assert(
            sameType<IsEqual<typeof loadConfig, (request: ConfigLoadRequest) => Promise<LoadedConfig>>, true>()
        );
        typeScope.assert(sameType<Config['outputRenderer'], DefinedOutputRenderer | undefined>());
        typeScope.assert(
            sameType<
                IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>,
                true
            >()
        );
        typeScope.assert(sameType<
            [{
                readonly execution: ProjectMicrotestProfileConfig['execution'];
                readonly testFamily: 'microtest';
            }] extends [ProjectProfileConfig] ? true : false,
            true
        >());
        typeScope.assert(sameType<
            [{
                readonly files: ProjectProfileFiles;
                readonly testFamily: 'integration';
            }] extends [ProjectProfileConfig] ? true : false,
            true
        >());
        typeScope.assert(sameType<
            [{
                readonly property: null;
                readonly baselines: OrdinaryBaselinePolicy;
                readonly attachments: AttachmentLimits;
                readonly failureArtifacts: FailureArtifactPolicy;
                readonly retries: null;
                readonly execution: {
                    readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                    readonly processModel: 'worker-pool';
                    readonly scheduling: 'concurrent';
                    readonly assignmentPolicy: 'case-count-balanced';
                    readonly dispatchPolicy: 'dynamic-lease';
                    readonly hedging: { readonly mode: 'off'; };
                    readonly maxConcurrency: MaxConcurrency;
                    readonly maxWorkers: null;
                    readonly workDistribution: { readonly mode: 'file'; };
                    readonly workerLifecycle: 'reuse';
                };
                readonly files: ProfileFiles;
                readonly reporters: null;
                readonly processUsage: ProcessUsagePolicy;
                readonly testFamily: 'integration';
                readonly runRecords: { readonly persist: 'on-demand'; };
                readonly timings: TimingProfilePolicy;
                readonly timeouts: RunExecutionFacts['timeoutPolicy'];
            }] extends [IntegrationProfileConfig] ? true : false,
            true
        >());
        typeScope.assert(sameType<
            [{
                readonly execution: {
                    readonly hostProcess: { readonly kind: 'child'; readonly nodeArguments: readonly string[]; };
                    readonly processModel: 'worker-pool';
                };
                readonly files: ProjectProfileFiles;
                readonly testFamily: 'integration';
            }] extends [ProjectIntegrationProfileConfig] ? true : false,
            false
        >());
        typeScope.assert(sameType.withActual<ConfigError>(), new ConfigError('Invalid config.'));
        return typeScope.assert.collect();
    })
]);
