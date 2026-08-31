import { describe, expect, test } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    RealTimeReporter
} from '../engine/engine.entry-point.ts';
import type {
    CompositeAssertionDefinition,
    CompositeCheckBuilder,
    NarrowingCompositeAssertionDefinition
} from './assert.entry-point.ts';
import type { unavailable as baselinesUnavailable } from './baselines.entry-point.ts';
import type { unavailable as benchUnavailable } from './bench.entry-point.ts';
import type {
    defineConfig,
    RunProjectConfig,
    RunProjectMicrotestProfileConfig,
    RunProjectProfileConfig,
    RunProjectProfileFiles,
    RunProjectResourceBudgets
} from './config.entry-point.ts';
import type {
    BriefReporterSinks,
    createBriefReporter,
    createDotReporter,
    createGithubActionsOutputRenderer,
    createLineReporter
} from './reporters.entry-point.ts';
import type { unavailable as resourcesUnavailable } from './resources.entry-point.ts';

type UnavailableStandardSubpathApi = (...parameters: readonly unknown[]) => never;
type CompositeBooleanDefinition = CompositeAssertionDefinition<
    [value: boolean],
    ReturnType<CompositeCheckBuilder<'assert'>['true']>
>;
type NarrowingStringDefinition = NarrowingCompositeAssertionDefinition<unknown, string, readonly []>;

describe('@overkill-dev/test standard subpaths', function () {
    test('exposes config authoring types', function () {
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<RunProjectProfileConfig>().type.toBe<RunProjectMicrotestProfileConfig>();
        expect<RunProjectProfileFiles['include']>().type.toBe<readonly [string, ...string[]]>();
        expect<keyof RunProjectResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
    });

    test('exposes reporter factories through the standard distribution', function () {
        expect<typeof createLineReporter>().type.toBe<() => DefinedReporter<RealTimeReporter>>();
        expect<typeof createBriefReporter>().type.toBe<
            () => DefinedReporter<RealTimeReporter<BriefReporterSinks>>
        >();
        expect<typeof createDotReporter>().type.toBe<() => DefinedReporter<RealTimeReporter>>();
        expect<typeof createGithubActionsOutputRenderer>().type.toBe<() => DefinedOutputRenderer>();
    });

    test('exposes assertion extension types from the assert package', function () {
        expect<CompositeBooleanDefinition['name']>().type.toBe<string>();
        expect<NarrowingStringDefinition['narrows']>().type.toBe<(actual: unknown) => actual is string>();
        expect<CompositeCheckBuilder<'assert'>['true']>().type.toBe<
            (actual: unknown) => ReturnType<CompositeCheckBuilder<'assert'>['true']>
        >();
    });

    test('exposes only unavailable sentinel types for reserved subpaths', function () {
        expect<typeof benchUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
        expect<typeof resourcesUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
        expect<typeof baselinesUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
    });
});
