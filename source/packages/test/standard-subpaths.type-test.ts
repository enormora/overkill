import { describe, expect, test } from 'tstyche';
import type {
    DefinedOutputRenderer,
    DefinedReporter,
    RealTimeReporter,
    TestBody,
    TestScope
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
    composeRuntimeContext,
    defineResource,
    defineRuntime,
    withRuntime,
    type ResourceContext,
    type ResourceHandle,
    type RuntimeContext,
    type RuntimeTestBody,
    type RuntimeTestScope
} from './resources.entry-point.ts';
import type { ParameterizedTestScope, TableTestBody } from './test.entry-point.ts';

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
type DatabaseContext = {
    readonly database: Database;
};
type ExpectedComposedRuntimeScope = TestScope & {
    readonly runtime: DatabaseContext;
};
type TableRow = {
    readonly value: number;
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
declare const testScope: TestScope;

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
        expect<ResourceContext<typeof runtime.resources>>().type.toBe<DatabaseContext>();
        expect<RuntimeContext<typeof runtime>>().type.toBe<{
            readonly database: Database;
        }>();
        expect(composeRuntimeContext(testScope, runtime, {
            database: { url: 'postgres://localhost' }
        }))
            .type
            .toBe<ExpectedComposedRuntimeScope>();
        expect(runtime.name).type.toBe<'api'>();
    });

    test('exposes runtime test context wrappers through the resources subpath', function () {
        const runtimeBody = withRuntime(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runWithDatabase(scope) {
            expect(scope).type.toBe<RuntimeTestScope<typeof runtime>>();
            expect(scope.runtime.database.url).type.toBe<string>();

            return scope.assert.collect();
        });
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runTableWithDatabase(scope) {
            expect(scope.parameters.value).type.toBe<number>();
            expect(scope.runtime.database.url).type.toBe<string>();

            return scope.assert.collect();
        });

        expect(runtimeBody).type.toBe<TestBody>();
        expect(tableRuntimeBody).type.toBe<TableTestBody<TableRow>>();
        expect<RuntimeTestBody<typeof runtime>>().type.toBe<
            (scope: RuntimeTestScope<typeof runtime>) => ReturnType<TestBody>
        >();
        expect<typeof withRuntime>().type.not.toBeCallableWith(runtime, {
            database: { port: 5432 }
        }, function runInvalidRuntimeScope(scope: RuntimeTestScope<typeof runtime>) {
            return scope.assert.collect();
        });
    });

    test('exposes only unavailable sentinel types for reserved subpaths', function () {
        expect<typeof benchUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
        expect<typeof baselinesUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
    });
});
