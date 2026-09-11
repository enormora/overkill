import { describe, expect, test } from 'tstyche';
import type {
    AssertAssertionFacade,
    DefinedOutputRenderer,
    DefinedReporter,
    RealTimeReporter,
    RequireAssertionFacade,
    TestBody,
    TestCase,
    TestScope
} from '../engine/engine.entry-point.ts';
import type {
    CompositeAssertionDefinition,
    CompositeCheckBuilder,
    NarrowingCompositeAssertionDefinition
} from './assert.entry-point.ts';
import type { unavailable as baselinesUnavailable } from './baselines.entry-point.ts';
import type { unavailable as benchUnavailable } from './bench.entry-point.ts';
import {
    throwingTest,
    type ThrowingTestAuthor,
    type ThrowingTestBody,
    type ThrowingTestDefinition,
    type ThrowingTestScope
} from './compatibility.entry-point.ts';
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
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    type ResourceLifecycleError,
    startRuntime,
    withRuntime,
    type ResourceContext,
    type ResourceHandle,
    type RuntimeSession,
    type RuntimeContext,
    type RuntimeTestBody,
    type RuntimeWrappedTestBody,
    type RuntimeTestScope,
    type TemporaryDirectoryHandle
} from './resources.entry-point.ts';
import {
    createTestFacade,
    table as rootTable,
    test as rootTest,
    type ParameterizedTestScope,
    type TableTestBody
} from './test.entry-point.ts';

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
const temporaryDirectory = createTemporaryDirectoryResource('scratch');
const typeTestController = new AbortController();
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

    test('exposes throwing test authoring through the compatibility subpath', function () {
        expect<typeof throwingTest>().type.toBe<ThrowingTestAuthor>();
        expect<ThrowingTestBody>().type.toBe<(scope: ThrowingTestScope) => Promise<void> | void>();
        expect<ThrowingTestScope>().type.toBe<{
            readonly assert: AssertAssertionFacade;
            readonly require: RequireAssertionFacade;
            readonly signal: AbortSignal;
        }>();
        expect<ThrowingTestScope>().type.not.toHaveProperty('plan');
        expect<ThrowingTestScope['assert']>().type.not.toHaveProperty('collect');
        expect(throwingTest('passes', function body() {
            return undefined;
        }))
            .type
            .toBe<TestCase>();
        expect(throwingTest({
            body() {
                return undefined;
            },
            controls: { timeoutMilliseconds: 50 },
            title: 'passes'
        }))
            .type
            .toBe<TestCase>();
        expect<ThrowingTestDefinition>().type.toBeAssignableFrom<{
            readonly body: ThrowingTestBody;
            readonly title: string;
        }>();
        expect(throwingTest).type.not.toBeCallableWith({
            body() {
                return undefined;
            },
            controls: { capture: 'live' },
            title: 'captures'
        });
    });

    test('exposes resource descriptor types through the standard distribution', function () {
        expect<ResourceHandle<typeof database>>().type.toBe<Database>();
        expect<ResourceHandle<typeof temporaryDirectory>>().type.toBe<TemporaryDirectoryHandle>();
        expect<ResourceContext<typeof runtime.resources>>().type.toBe<DatabaseContext>();
        expect<RuntimeContext<typeof runtime>>().type.toBe<{
            readonly database: Database;
        }>();
        expect(startRuntime({ runtime, signal: typeTestController.signal })).type.toBe<
            Promise<RuntimeSession<typeof runtime>>
        >();
        expect<ResourceLifecycleError>().type.toBeAssignableTo<Error>();
        expect(composeRuntimeContext(testScope, runtime, {
            database: { url: 'postgres://localhost' }
        }))
            .type
            .toBe<ExpectedComposedRuntimeScope>();
        expect(runtime.name).type.toBe<'api'>();
        expect(temporaryDirectory.name).type.toBe<'scratch'>();
        expect<TemporaryDirectoryHandle>().type.toBe<{ readonly path: string; }>();
    });

    test('exposes runtime test context wrappers through the resources subpath', function () {
        const runtimeBody = withRuntime(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runWithDatabase(scope) {
            expect(scope).type.toBe<RuntimeTestScope<typeof runtime>>();
            expect(scope.runtime.database.url).type.toBe<string>();

            return scope.assert.collect();
        });

        expect(runtimeBody).type.toBe<RuntimeWrappedTestBody>();
        expect(runtimeBody).type.toBeAssignableTo<TestBody>();
        expect<RuntimeTestBody<typeof runtime>>().type.toBe<
            (scope: RuntimeTestScope<typeof runtime>) => ReturnType<TestBody>
        >();
        expect<typeof withRuntime>().type.not.toBeCallableWith(runtime, {
            database: { port: 5432 }
        }, function runInvalidRuntimeScope(scope: RuntimeTestScope<typeof runtime>) {
            return scope.assert.collect();
        });
    });

    test('types table runtime wrappers through the resources subpath', function () {
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runTableWithDatabase(scope) {
            expect(scope.parameters.value).type.toBe<number>();
            expect(scope.runtime.database.url).type.toBe<string>();

            return scope.assert.collect();
        });

        expect(tableRuntimeBody).type.toBe<RuntimeWrappedTestBody<ParameterizedTestScope<TableRow>>>();
        expect(tableRuntimeBody).type.toBeAssignableTo<TableTestBody<TableRow>>();
    });

    test('rejects runtime wrappers from microtest authoring types', function () {
        const runtimeBody = withRuntime(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runWithDatabase(scope) {
            return scope.assert.collect();
        });
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runTableWithDatabase(scope) {
            return scope.assert.collect();
        });
        const microtestFacade = createTestFacade({ testFamily: 'microtest' });

        expect(rootTest).type.not.toBeCallableWith('uses database', runtimeBody);
        expect(rootTest).type.not.toBeCallableWith({ body: runtimeBody, title: 'uses database' });
        expect(microtestFacade.test).type.not.toBeCallableWith('uses database', runtimeBody);
        expect(rootTable).type.not.toBeCallableWith({
            cases: [ { value: 1 }, { value: 2 } ],
            test: tableRuntimeBody,
            title: 'rows'
        });
        expect(microtestFacade.table).type.not.toBeCallableWith({
            cases: [ { value: 1 }, { value: 2 } ],
            test: tableRuntimeBody,
            title: 'rows'
        });
    });

    test('accepts runtime wrappers from integration authoring types', function () {
        const runtimeBody = withRuntime(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runWithDatabase(scope) {
            return scope.assert.collect();
        });
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(runtime, {
            database: { url: 'postgres://localhost' }
        }, function runTableWithDatabase(scope) {
            return scope.assert.collect();
        });
        const integrationFacade = createTestFacade({ testFamily: 'integration' });

        expect(integrationFacade.test).type.toBeCallableWith('uses database', runtimeBody);
        expect(integrationFacade.table).type.toBeCallableWith({
            cases: [ { value: 1 }, { value: 2 } ],
            test: tableRuntimeBody,
            title: 'rows'
        });
    });

    test('exposes only unavailable sentinel types for reserved subpaths', function () {
        expect<typeof benchUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
        expect<typeof baselinesUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
    });
});
