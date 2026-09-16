import { describe, expect, test } from 'tstyche';
import type {
    AssertAssertionFacade,
    DefinedOutputRenderer,
    DefinedReporter,
    RealTimeReporter,
    RequireAssertionFacade,
    Table,
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
    withResource,
    withResources,
    withRuntime,
    type ResourceContext,
    type ResourceHandle,
    type ResourceScopeContext,
    type ResourceTestScope,
    type ResourceWrappedTestBody,
    type RuntimeGraph,
    type RuntimeSession,
    type RuntimeContext,
    type RuntimeScopeContext,
    type RuntimeTestScope,
    type RuntimeWrappedTestBody,
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
type ProjectedDatabase = {
    readonly connectionString: string;
};
type DatabaseContext = {
    readonly database: Database;
};
type ExpectedComposedRuntimeScope = TestScope & {
    readonly runtimes: {
        readonly api: DatabaseContext;
    };
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
const projectedDatabase = defineResource({
    name: 'projected-database',
    scope: 'per-file',
    requirements: [],
    acquire(): Database {
        return { url: 'postgres://localhost' };
    },
    deserializeHandle(payload: string): ProjectedDatabase {
        return { connectionString: payload };
    },
    dispose: null,
    serializeHandle(handle): string {
        return handle.url;
    }
});
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
        expect(throwingTest).type.toBeCallableWith({
            body() {
                return undefined;
            },
            controls: { capture: 'live' },
            title: 'captures'
        });
    });

    describe('@overkill-dev/test/resources standard subpath', function () {
        test('exposes resource descriptor types through the standard distribution', function () {
            expect<ResourceHandle<typeof database>>().type.toBe<Database>();
            expect<ResourceHandle<typeof temporaryDirectory>>().type.toBe<TemporaryDirectoryHandle>();
            expect<ResourceContext<typeof runtime.resources>>().type.toBe<DatabaseContext>();
            expect<RuntimeContext<typeof runtime>>().type.toBe<{
                readonly database: Database;
            }>();
            expect<RuntimeScopeContext<typeof runtime>>().type.toBe<{
                readonly api: {
                    readonly database: Database;
                };
            }>();
            expect<ResourceScopeContext<{ readonly dir: typeof temporaryDirectory; }>>().type.toBe<{
                readonly dir: TemporaryDirectoryHandle;
            }>();
            expect(runtime.name).type.toBe<'api'>();
            expect(temporaryDirectory.name).type.toBe<'scratch'>();
            expect<TemporaryDirectoryHandle>().type.toBe<{ readonly path: string; }>();
        });

        test('exposes projected resource descriptor types through the standard distribution', function () {
            expect<ResourceHandle<typeof projectedDatabase>>().type.toBe<ProjectedDatabase>();
            expect(projectedDatabase.name).type.toBe<'projected-database'>();
        });

        test('exposes resource lifecycle types through the standard distribution', function () {
            expect(startRuntime({ runtime, signal: typeTestController.signal })).type.toBe<
                Promise<RuntimeSession<typeof runtime>>
            >();
            expect<ResourceLifecycleError>().type.toBeAssignableTo<Error>();
            expect(composeRuntimeContext(testScope, runtime, {
                database: { url: 'postgres://localhost' }
            }))
                .type
                .toBe<ExpectedComposedRuntimeScope>();
        });

        test('exposes runtime test context wrappers through the resources subpath', function () {
            const runtimeBody = withRuntime(runtime, function runWithDatabase(scope) {
                expect(scope).type.toBe<RuntimeTestScope<typeof runtime>>();
                expect(scope.runtimes.api.database).type.toBe<Database>();

                return scope.assert.collect();
            });

            expect(runtimeBody).type.toBe<RuntimeWrappedTestBody<typeof runtime>>();
            expect(runtimeBody).type.toBeAssignableTo<TestBody>();
            expect<RuntimeGraph>().type.toBeAssignableFrom<typeof runtime>();
            expect<typeof withRuntime>().type.not.toBeCallableWith(runtime, {
                database: { url: 'postgres://localhost' }
            }, function runInvalidRuntimeScope(scope: TestScope) {
                return scope.assert.collect();
            });
        });

        test('types table runtime wrappers through the resources subpath', function () {
            const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
                runtime,
                function runTableWithDatabase(scope) {
                    expect(scope).type.toBe<RuntimeTestScope<typeof runtime, ParameterizedTestScope<TableRow>>>();
                    expect(scope.parameters.value).type.toBe<number>();
                    expect(scope.runtimes.api.database.url).type.toBe<string>();

                    return scope.assert.collect();
                }
            );

            expect(tableRuntimeBody).type.toBe<
                RuntimeWrappedTestBody<typeof runtime, ParameterizedTestScope<TableRow>>
            >();
            expect(tableRuntimeBody).type.toBeAssignableTo<TableTestBody<TableRow>>();
        });

        test('types direct resource wrappers through the resources subpath', function () {
            const resourceBody = withResource(temporaryDirectory, function runWithScratch(scope) {
                expect(scope).type.toBe<ResourceTestScope<Record<'scratch', typeof temporaryDirectory>>>();
                expect(scope.resources.scratch).type.toBe<TemporaryDirectoryHandle>();

                return scope.assert.collect();
            });
            const resourcesBody = withResources({ dir: temporaryDirectory }, function runWithResources(scope) {
                expect(scope).type.toBe<ResourceTestScope<{ readonly dir: typeof temporaryDirectory; }>>();
                expect(scope.resources.dir.path).type.toBe<string>();

                return scope.assert.collect();
            });

            expect(resourceBody).type.toBe<ResourceWrappedTestBody<Record<'scratch', typeof temporaryDirectory>>>();
            expect(resourcesBody).type.toBe<ResourceWrappedTestBody<{ readonly dir: typeof temporaryDirectory; }>>();
            expect(resourceBody).type.toBeAssignableTo<TestBody>();
            expect(resourcesBody).type.toBeAssignableTo<TestBody>();
        });

        test('types nested resource wrappers through explicit scope generics', function () {
            const nestedBody = withResource(
                temporaryDirectory,
                withRuntime<typeof runtime, ResourceTestScope<Record<'scratch', typeof temporaryDirectory>>>(
                    runtime,
                    function runWithScratchAndRuntime(scope) {
                        expect(scope.resources.scratch).type.toBe<TemporaryDirectoryHandle>();
                        expect(scope.runtimes.api.database).type.toBe<Database>();

                        return scope.assert.collect();
                    }
                )
            );

            expect(nestedBody).type.toBeAssignableTo<TestBody>();
        });

        test('accepts descriptor wrappers from neutral test authoring types', function () {
            const runtimeBody = withRuntime(runtime, function runWithDatabase(scope) {
                return scope.assert.collect();
            });
            const resourceBody = withResource(temporaryDirectory, function runWithScratch(scope) {
                return scope.assert.collect();
            });
            const facade = createTestFacade();

            expect(rootTest).type.toBeCallableWith('uses database', runtimeBody);
            expect(rootTest).type.toBeCallableWith('uses scratch', resourceBody);
            expect(rootTest).type.toBeCallableWith({ body: runtimeBody, title: 'uses database' });
            expect(facade.test).type.toBeCallableWith('uses database', runtimeBody);
            expect(facade.test).type.toBeCallableWith('uses scratch', resourceBody);
        });

        test('accepts descriptor wrappers from neutral table authoring types', function () {
            const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
                runtime,
                function runTableWithDatabase(scope) {
                    return scope.assert.collect();
                }
            );
            const tableResourceBody = withResource<typeof temporaryDirectory, ParameterizedTestScope<TableRow>>(
                temporaryDirectory,
                function runTableWithScratch(scope) {
                    return scope.assert.collect();
                }
            );
            const facade = createTestFacade();

            expect(rootTable).type.toBeCallableWith({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableRuntimeBody,
                title: 'rows'
            });
            expect(rootTable).type.toBeCallableWith({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableResourceBody,
                title: 'rows'
            });
            expect(facade.table).type.toBeCallableWith({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableRuntimeBody,
                title: 'rows'
            });
            expect(facade.table).type.toBeCallableWith({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableResourceBody,
                title: 'rows'
            });
        });

        test('accepts runtime wrappers from neutral authoring types', function () {
            const runtimeBody = withRuntime(runtime, function runWithDatabase(scope) {
                return scope.assert.collect();
            });
            const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
                runtime,
                function runTableWithDatabase(scope) {
                    return scope.assert.collect();
                }
            );
            const facade = createTestFacade();

            expect(facade.test).type.toBeCallableWith('uses database', runtimeBody);
            expect(facade.table).type.toBeCallableWith({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableRuntimeBody,
                title: 'rows'
            });
        });

        test('types facade-bound runtime resources and mapped scope', function () {
            const facade = createTestFacade({
                runtime,
                resources: { scratch: temporaryDirectory },
                mapScope(scope) {
                    expect(scope.runtimes.api.database).type.toBe<Database>();
                    expect(scope.resources.scratch).type.toBe<TemporaryDirectoryHandle>();

                    return {
                        databaseUrl: scope.runtimes.api.database.url,
                        scratchPath: scope.resources.scratch.path
                    };
                }
            });

            expect(facade.test('uses facade runtime', function runWithFacade(scope) {
                expect(scope.databaseUrl).type.toBe<string>();
                expect(scope.scratchPath).type.toBe<string>();
                expect(scope.resources.scratch).type.toBe<TemporaryDirectoryHandle>();
                expect(scope.runtimes.api.database).type.toBe<Database>();

                return scope.assert.collect();
            }))
                .type
                .toBe<TestCase>();
            expect(facade.table({
                cases: [ { value: 1 }, { value: 2 } ],
                test(scope) {
                    expect(scope.parameters.value).type.toBe<number>();
                    expect(scope.databaseUrl).type.toBe<string>();
                    expect(scope.resources.scratch.path).type.toBe<string>();

                    return scope.assert.collect();
                },
                title: 'rows'
            }))
                .type
                .toBe<Table>();
        });
    });

    test('exposes only unavailable sentinel types for reserved subpaths', function () {
        expect<typeof benchUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
        expect<typeof baselinesUnavailable>().type.toBe<UnavailableStandardSubpathApi>();
    });
});
