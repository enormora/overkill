import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { acceptsCall, assignableFrom, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    FinalResultReporter,
    RealTimeReporter
} from '../engine/engine.entry-point.ts';
import type { PerformanceBaselineAdapter } from '../baselines/baselines.entry-point.ts';
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

export const testNode = suite('@overkill-dev/test standard subpaths', [
    test('exposes config authoring types', function (typeScope) {
        typeScope.assert(acceptsCall, () => defineConfigUnderTest({ profiles: { unit: { testFamily: 'microtest' } } }));
        typeScope.assert(
            sameType<[ProjectIntegrationProfileConfig] extends [ProjectProfileConfig] ? true : false, true>()
        );
        typeScope.assert(
            sameType<[ProjectMicrotestProfileConfig] extends [ProjectProfileConfig] ? true : false, true>()
        );
        typeScope.assert(
            sameType<[ProjectBenchmarkProfileConfig] extends [ProjectProfileConfig] ? true : false, true>()
        );
        typeScope.assert(
            sameType<
                Extract<ProjectProfileConfig, { readonly testFamily: 'property'; }>,
                ProjectPropertyProfileConfig
            >()
        );
        typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFilePatterns>());
        typeScope.assert(assignableFrom<ProjectProfileFiles, ProjectProfileFileSets>());
        typeScope.assert(
            sameType<
                keyof ProjectProcessBudgets,
                [
                    'activeResourceCount',
                    'javaScriptEngineHeapBytes',
                    'residentSetBytes',
                    'residentSetGrowthBytesPerSecond'
                ][number]
            >()
        );
        return typeScope.assert.collect();
    }),
    test('exposes reporter factories through the standard distribution', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof createLineReporter, LineReporterFactory>, true>());
        typeScope.assert(sameType<IsEqual<typeof createLineProgressReporter, LineProgressReporterFactory>, true>());
        typeScope.assert(sameType<IsEqual<typeof createLineTreeReporter, LineTreeReporterFactory>, true>());
        typeScope.assert(
            sameType<
                IsEqual<
                    typeof createBriefFinalResultReporter,
                    () => DefinedReporter<FinalResultReporter<BriefReporterSinks>>
                >,
                true
            >()
        );
        typeScope.assert(
            sameType<
                IsEqual<typeof createBriefReporter, () => DefinedReporter<RealTimeReporter<BriefReporterSinks>>>,
                true
            >()
        );
        typeScope.assert(sameType<IsEqual<typeof createDotReporter, () => DefinedReporter<RealTimeReporter>>, true>());
        typeScope.assert(sameType<typeof createGithubActionsOutputRenderer, () => DefinedOutputRenderer>());
        return typeScope.assert.collect();
    }),
    test('exposes assertion extension types from the assert package', function (typeScope) {
        typeScope.assert(sameType<CompositeBooleanDefinition['name'], string>());
        typeScope.assert(sameType<NarrowingStringDefinition['narrows'], (actual: unknown) => actual is string>());
        typeScope.assert(
            sameType<
                CompositeCheckBuilder<'assert'>['true'],
                (actual: unknown) => ReturnType<CompositeCheckBuilder<'assert'>['true']>
            >()
        );
        return typeScope.assert.collect();
    }),
    test('reexports the leaf performance baseline contract', function (typeScope) {
        typeScope.assert(sameType<IsEqual<StandardBaselineAdapter, PerformanceBaselineAdapter>, true>());
        return typeScope.assert.collect();
    })
]);
