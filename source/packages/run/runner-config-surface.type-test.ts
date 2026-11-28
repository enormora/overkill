import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, sameType } from '@overkill-dev/type-test';
import type { ProjectDefinedFamilyProfile } from '../../config/schema.ts';
import type {
    AttachmentLimits,
    FailureArtifactPolicy,
    DefinedOutputRenderer,
    DefinedReporter
} from '../engine/engine.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
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

export const testNode = suite('Runner profile and execution policy configuration', [
    test('exposes collection, soft, and hard timeout facts', function (scope) {
        scope.assert(sameType<RunExecutionFacts['timeoutPolicy']['collectionMilliseconds'], number>());
        scope.assert(sameType<RunExecutionFacts['timeoutPolicy']['hardMilliseconds'], number>());
        scope.assert(sameType<RunExecutionFacts['timeoutPolicy']['softMilliseconds'], number>());
        return scope.assert.collect();
    }),
    test('exposes config and resolution errors', function (scope) {
        scope.assert(
            sameType<
                keyof NormalizedConfig,
                'history' | 'loader' | 'outputRenderer' | 'profiles' | 'reporters' | 'runtimeStateDir'
            >()
        );
        scope.assert(sameType<IsEqual<NormalizedConfig['outputRenderer'], DefinedOutputRenderer>, true>());
        scope.assert(sameType<IsEqual<NormalizedConfig['profiles'][string], ProfileConfig>, true>());
        scope.assert(
            sameType<
                IsEqual<ProfileConfig, BenchmarkProfileConfig | DefinedFamilyProfile | OrdinaryProfile>,
                true
            >()
        );
        scope.assert(sameType<IsEqual<NormalizedConfig['profiles']['backend-http'], ProfileConfig>, true>());
        scope.assert(
            sameType<IsEqual<NormalizedConfig['reporters'], readonly DefinedReporter[] | null>, true>()
        );
        scope.assert(sameType<IsEqual<TestProfileConfig['timings'], TimingProfilePolicy>, true>());
        scope.assert(
            sameType<IsEqual<TimingProfilePolicy, { readonly collection: TimingCollectionMode; }>, true>()
        );
        scope.assert(
            sameType<IsEqual<ProjectTimingProfilePolicy, { readonly collection: TimingCollectionMode; }>, true>()
        );
        return scope.assert.collect();
    }),
    test('exposes run process budget and resolution error types', function (scope) {
        scope.assert(sameType<
            IsEqual<
                keyof ProcessBudgets,
                [
                    'activeResourceCount',
                    'javaScriptEngineHeapBytes',
                    'residentSetBytes',
                    'residentSetGrowthBytesPerSecond'
                ][number]
            >,
            true
        >());
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<RunResolutionError>()(new RunResolutionError('Unsupported.', undefined, 'unsupported-request'))
        );
        scope.assert(
            sameType<
                IsEqual<
                    ReturnType<RunExecutionPlanError['conflicts']>,
                    readonly [RunExecutionPlanConflict, ...readonly RunExecutionPlanConflict[]]
                >,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('exposes profile file discovery types', function (scope) {
        scope.assert(sameType<IsEqual<MicrotestProfileConfig['files'], ProfileFiles | null>, true>());
        scope.assert(sameType<IsEqual<IntegrationProfileConfig['files'], ProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<RuntimeProfileFilePatterns, ProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<RuntimeProfileFileSets, ProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<MixedRuntimeProfileFiles, ProfileFiles>, false>());
        scope.assert(
            sameType<IsEqual<ProjectMicrotestProfileConfig['files'], ProjectProfileFiles | undefined>, true>()
        );
        scope.assert(sameType<IsEqual<ProjectIntegrationProfileConfig['files'], ProjectProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<ProjectProfileFilePatterns, ProjectProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<ProjectProfileFileSets, ProjectProfileFiles>, true>());
        return scope.assert.collect();
    }),
    test('exposes property profile config types', function (scope) {
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
        return scope.assert.collect();
    }),
    test('exposes config loading helpers from the main package surface', function (scope) {
        scope.assert(
            acceptsCall,
            function () {
                return defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } });
            }
        );
        scope.assert(
            sameType<IsEqual<typeof loadConfig, (request: ConfigLoadRequest) => Promise<LoadedConfig>>, true>()
        );
        scope.assert(sameType<IsEqual<Config['outputRenderer'], DefinedOutputRenderer | undefined>, true>());
        scope.assert(
            sameType<
                IsEqual<Config['reporters'], readonly [DefinedReporter, ...DefinedReporter[]] | undefined>,
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
        scope.assert(sameType<
            [{
                readonly files: ProjectProfileFiles;
                readonly testFamily: 'integration';
            }] extends [ProjectProfileConfig] ? true : false,
            true
        >());
        scope.assert(sameType<
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
        scope.assert(sameType<
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
        scope.assert(sameType.withActual<true>(), isEqualTo<ConfigError>()(new ConfigError('Invalid config.')));
        return scope.assert.collect();
    })
]);
