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
    RunProjectIntegrationProfileConfig,
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
    createLineReporter,
    LineReporterOptions
} from './reporters.entry-point.ts';
import {
    defineResource,
    defineRuntime,
    type ResourceHandle,
    type RuntimeContext
} from './resources.entry-point.ts';

type UnavailableStandardSubpathApi = (...parameters: readonly unknown[]) => never;
type LineReporterFactory = (options?: LineReporterOptions) => DefinedReporter<RealTimeReporter>;
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
type Database = {
    readonly url: string;
};

const database = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [],
    acquire(): Database {
        return { url: 'postgres://localhost' };
    },
    dispose: null
});
const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { database },
    requirements: []
});

describe('@overkill-dev/test standard subpaths', function () {
    test('exposes config authoring types', function () {
        expect<typeof defineConfig>().type.toBe<(config: RunProjectConfig) => RunProjectConfig>();
        expect<RunProjectProfileConfig>().type.toBe<
            RunProjectIntegrationProfileConfig | RunProjectMicrotestProfileConfig
        >();
        expect<RunProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFilePatterns>();
        expect<RunProjectProfileFiles>().type.toBeAssignableFrom<ProjectProfileFileSets>();
        expect<keyof RunProjectResourceBudgets>().type.toBe<
            'activeResourceCount' | 'javaScriptEngineHeapBytes' | 'residentSetBytes' | 'residentSetGrowthBytesPerSecond'
        >();
    });

    test('exposes reporter factories through the standard distribution', function () {
        expect<typeof createLineReporter>().type.toBe<LineReporterFactory>();
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

    test('exposes resource descriptor types through the standard distribution', function () {
        expect<ResourceHandle<typeof database>>().type.toBe<Database>();
        expect<RuntimeContext<typeof runtime>>().type.toBe<{
            readonly database: Database;
        }>();
        expect(runtime.name).type.toBe<'api'>();
    });

    test('exposes only unavailable sentinel types for reserved subpaths', function () {
        expect<typeof benchUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
        expect<typeof baselinesUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
    });
});
