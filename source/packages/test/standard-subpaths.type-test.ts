import type { IsEqual } from 'type-fest';
import { acceptsCall, sameType } from '@overkill-dev/type-test';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    FinalResultReporter,
    RealTimeReporter
} from '../engine/engine.entry-point.ts';
import type { PerformanceBaselineAdapter } from '../baselines/baselines.entry-point.ts';
import type { IsAssignable } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import type {
    CompositeAssertionDefinition,
    CompositeCheckBuilder,
    NarrowingCompositeAssertionDefinition
} from './assert.entry-point.ts';
import type { PerformanceBaselineAdapter as StandardBaselineAdapter } from './baselines.entry-point.ts';
import type {
    defineConfig,
    ProjectIntegrationProfileConfig,
    ProjectMicrotestProfileConfig,
    ProjectPropertyProfileConfig,
    ProjectProfileConfig,
    ProjectBenchmarkProfileConfig,
    ProjectProfileFiles,
    ProjectProcessBudgets
} from './config.entry-point.ts';
import type {
    BriefReporterSinks,
    createBriefFinalResultReporter,
    createBriefReporter,
    createDotReporter,
    createGithubActionsOutputRenderer,
    createLineProgressReporter,
    createLineReporter,
    createLineTreeReporter,
    LineProgressReporterOptions,
    LineReporterOptions,
    LineTreeReporterOptions
} from './reporters.entry-point.ts';

type LineReporterFactory = (options?: LineReporterOptions) => DefinedReporter<RealTimeReporter>;
type LineProgressReporterFactory = (
    options?: LineProgressReporterOptions
) => DefinedReporter<RealTimeReporter>;
type LineTreeReporterFactory = (
    options?: LineTreeReporterOptions
) => DefinedReporter<FinalResultReporter>;
type CompositeBooleanDefinition = CompositeAssertionDefinition<
    [value: boolean],
    ReturnType<CompositeCheckBuilder<'assert'>['true']>
>;
type NarrowingStringDefinition = NarrowingCompositeAssertionDefinition<unknown, string, readonly []>;
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

declare const defineConfigUnderTest: typeof defineConfig;

export const testNode = suite('Public authoring subpath contracts', [
    test('exposes config authoring types', function (scope) {
        scope.assert(acceptsCall, function () {
            return defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } });
        });
        scope.assert(
            sameType<[ProjectIntegrationProfileConfig] extends [ProjectProfileConfig] ? true : false, true>()
        );
        scope.assert(
            sameType<[ProjectMicrotestProfileConfig] extends [ProjectProfileConfig] ? true : false, true>()
        );
        scope.assert(
            sameType<[ProjectBenchmarkProfileConfig] extends [ProjectProfileConfig] ? true : false, true>()
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
        scope.assert(sameType<IsAssignable<ProjectProfileFilePatterns, ProjectProfileFiles>, true>());
        scope.assert(sameType<IsAssignable<ProjectProfileFileSets, ProjectProfileFiles>, true>());
        scope.assert(sameType<
            IsEqual<
                keyof ProjectProcessBudgets,
                [
                    'activeResourceCount',
                    'javaScriptEngineHeapBytes',
                    'residentSetBytes',
                    'residentSetGrowthBytesPerSecond'
                ][number]
            >,
            true
        >());
        return scope.assert.collect();
    }),
    test('exposes reporter factories through the standard distribution', function (scope) {
        scope.assert(sameType<IsEqual<typeof createLineReporter, LineReporterFactory>, true>());
        scope.assert(sameType<IsEqual<typeof createLineProgressReporter, LineProgressReporterFactory>, true>());
        scope.assert(sameType<IsEqual<typeof createLineTreeReporter, LineTreeReporterFactory>, true>());
        scope.assert(
            sameType<
                IsEqual<
                    typeof createBriefFinalResultReporter,
                    () => DefinedReporter<FinalResultReporter<BriefReporterSinks>>
                >,
                true
            >()
        );
        scope.assert(
            sameType<
                IsEqual<typeof createBriefReporter, () => DefinedReporter<RealTimeReporter<BriefReporterSinks>>>,
                true
            >()
        );
        scope.assert(sameType<IsEqual<typeof createDotReporter, () => DefinedReporter<RealTimeReporter>>, true>());
        scope.assert(
            sameType<IsEqual<typeof createGithubActionsOutputRenderer, () => DefinedOutputRenderer>, true>()
        );
        return scope.assert.collect();
    }),
    test('exposes assertion extension types from the assert package', function (scope) {
        scope.assert(sameType<CompositeBooleanDefinition['name'], string>());
        scope.assert(
            sameType<IsEqual<NarrowingStringDefinition['narrows'], (actual: unknown) => actual is string>, true>()
        );
        scope.assert(
            sameType<
                IsEqual<
                    CompositeCheckBuilder<'assert'>['true'],
                    (actual: unknown) => ReturnType<CompositeCheckBuilder<'assert'>['true']>
                >,
                true
            >()
        );
        return scope.assert.collect();
    }),
    test('reexports the leaf performance baseline contract', function (scope) {
        scope.assert(sameType<IsEqual<StandardBaselineAdapter, PerformanceBaselineAdapter>, true>());
        return scope.assert.collect();
    })
]);
