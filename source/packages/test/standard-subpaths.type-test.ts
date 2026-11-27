import type { IsEqual } from 'type-fest';
import { isEqualTo } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import type {
    AssertAssertionFacade,
    DefinedOutputRenderer,
    DefinedReporter,
    FinalResultReporter,
    RealTimeReporter,
    RequireAssertionFacade,
    Table,
    TestBody,
    TestCase,
    TestDebugScope,
    TestScope,
    TestRandom
} from '../engine/engine.entry-point.ts';
import type { PerformanceBaselineAdapter } from '../baselines/baselines.entry-point.ts';
import type {
    CompositeAssertionDefinition,
    CompositeCheckBuilder,
    NarrowingCompositeAssertionDefinition
} from './assert.entry-point.ts';
import type { PerformanceBaselineAdapter as StandardBaselineAdapter } from './baselines.entry-point.ts';
import {
    throwingTest,
    type ThrowingTestAuthor,
    type ThrowingTestBody,
    type ThrowingTestDefinition,
    type ThrowingTestScope
} from './compatibility.entry-point.ts';
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
import {
    composeRuntimeContext,
    composeRuntimes,
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
    type RuntimeAttachments,
    type ResourceWrappedTestBody,
    type RuntimeGraph,
    type RuntimeSession,
    type RuntimeContext,
    type RuntimeScopeContext,
    type RuntimeTestScope,
    type RuntimeWrappedTestBody,
    type TemporaryDirectoryHandle,
    type TranscriptView
} from './resources.entry-point.ts';
import {
    createTestFacade,
    table as rootTable,
    test as rootTest,
    type ParameterizedTestScope,
    type TableTestBody
} from './test.entry-point.ts';

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
const secondaryRuntime = defineRuntime({
    name: 'secondary',
    dimensions: {},
    resources: { database },
    requirements: []
});
const composedRuntime = composeRuntimes(runtime, secondaryRuntime);
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

declare const defineConfigUnderTest: typeof defineConfig;
declare const withRuntimeUnderTest: typeof withRuntime;

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
                | 'activeResourceCount'
                | 'javaScriptEngineHeapBytes'
                | 'residentSetBytes'
                | 'residentSetGrowthBytesPerSecond'
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
    test('exposes throwing test authoring through the compatibility subpath', function (typeScope) {
        typeScope.assert(sameType<IsEqual<typeof throwingTest, ThrowingTestAuthor>, true>());
        typeScope.assert(sameType<ThrowingTestBody, (scope: ThrowingTestScope) => Promise<void> | void>());
        typeScope.assert(sameType<ThrowingTestScope, {
            readonly debug: TestDebugScope;
            readonly seed: bigint;
            readonly random: TestRandom;
            readonly assert: AssertAssertionFacade;
            readonly require: RequireAssertionFacade;
            readonly signal: AbortSignal;
        }>());
        typeScope.assert(assignableFrom.not<keyof ThrowingTestScope, 'plan'>());
        typeScope.assert(assignableFrom.not<keyof ThrowingTestScope['assert'], 'collect'>());
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<TestCase>()(throwingTest('passes', function body() {
                return undefined;
            }))
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<TestCase>()(throwingTest({
                body() {
                    return undefined;
                },
                controls: { timeoutMilliseconds: 50 },
                title: 'passes'
            }))
        );
        typeScope.assert(sameType<
            [{
                readonly body: ThrowingTestBody;
                readonly title: string;
            }] extends [ThrowingTestDefinition] ? true : false,
            true
        >());
        typeScope.assert(acceptsCall, () =>
            throwingTest({
                body() {
                    return undefined;
                },
                controls: { capture: 'live' },
                title: 'captures'
            }));
        return typeScope.assert.collect();
    }),
    suite('@overkill-dev/test/resources standard subpath', [
        test('exposes resource descriptor types through the standard distribution', function (typeScope) {
            typeScope.assert(sameType<ResourceHandle<typeof database>, Database>());
            typeScope.assert(sameType<ResourceHandle<typeof temporaryDirectory>, TemporaryDirectoryHandle>());
            typeScope.assert(sameType<ResourceContext<typeof runtime.resources>, DatabaseContext>());
            typeScope.assert(sameType<
                IsEqual<ResourceScopeContext<{ readonly dir: typeof temporaryDirectory; }>, {
                    readonly dir: TemporaryDirectoryHandle;
                }>,
                true
            >());
            typeScope.assert(sameType.withActual<'scratch'>(), temporaryDirectory.name);
            typeScope.assert(sameType<TemporaryDirectoryHandle, {
                readonly path: string;
                readonly transcript: TranscriptView<never>;
            }>());
            return typeScope.assert.collect();
        }),
        test('exposes runtime descriptor types through the standard distribution', function (typeScope) {
            typeScope.assert(sameType<
                IsEqual<RuntimeContext<typeof runtime>, {
                    readonly database: Database;
                }>,
                true
            >());
            typeScope.assert(sameType<
                IsEqual<RuntimeScopeContext<typeof runtime>, {
                    readonly api: {
                        readonly database: Database;
                    };
                }>,
                true
            >());
            typeScope.assert(sameType.withActual<'api'>(), runtime.name);
            return typeScope.assert.collect();
        }),
        test('exposes projected resource descriptor types through the standard distribution', function (typeScope) {
            typeScope.assert(sameType<ResourceHandle<typeof projectedDatabase>, ProjectedDatabase>());
            typeScope.assert(sameType.withActual<'projected-database'>(), projectedDatabase.name);
            return typeScope.assert.collect();
        }),
        test('exposes resource lifecycle types through the standard distribution', function (typeScope) {
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<RuntimeSession<typeof runtime>>>()(
                    startRuntime({ runtime, signal: typeTestController.signal })
                )
            );
            typeScope.assert(assignableTo<ResourceLifecycleError, Error>());
            typeScope.assert(
                sameType.withActual<ExpectedComposedRuntimeScope>(),
                composeRuntimeContext(testScope, runtime, {
                    database: { url: 'postgres://localhost' }
                })
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<DatabaseContext>()(
                    composeRuntimeContext(testScope, composedRuntime, {
                        api: { database: { url: 'postgres://localhost' } },
                        secondary: { database: { url: 'postgres://localhost' } }
                    })
                        .runtimes
                        .secondary
                )
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('@overkill-dev/test/resources wrapper standard subpath', [
        test('exposes runtime test context wrappers through the resources subpath', function (typeScope) {
            const runtimeBody = withRuntime(runtime, function runWithDatabase(scope) {
                typeScope.assert(sameType<IsEqual<typeof scope, RuntimeTestScope<typeof runtime>>, true>());
                typeScope.assert(sameType.withActual<Database>(), scope.runtimes.api.database);
                typeScope.assert(sameType.withActual<RuntimeAttachments>(), scope.attachments);

                return scope.assert.collect();
            });

            typeScope.assert(sameType<IsEqual<typeof runtimeBody, RuntimeWrappedTestBody<typeof runtime>>, true>());
            typeScope.assert(sameType<[typeof runtimeBody] extends [TestBody] ? true : false, true>());
            typeScope.assert(assignableFrom<RuntimeGraph, typeof runtime>());
            typeScope.assert(rejectsCall('argument-count'), () =>
                withRuntimeUnderTest(runtime, {
                    database: { url: 'postgres://localhost' }
                }, function runInvalidRuntimeScope(scope: TestScope) {
                    return scope.assert.collect();
                }));
            return typeScope.assert.collect();
        }),
        test('types table runtime wrappers through the resources subpath', function (typeScope) {
            const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
                runtime,
                function runTableWithDatabase(scope) {
                    typeScope.assert(
                        sameType<
                            IsEqual<typeof scope, RuntimeTestScope<typeof runtime, ParameterizedTestScope<TableRow>>>,
                            true
                        >()
                    );
                    typeScope.assert(sameType.withActual<number>(), scope.parameters.value);
                    typeScope.assert(sameType.withActual<string>(), scope.runtimes.api.database.url);

                    return scope.assert.collect();
                }
            );

            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof tableRuntimeBody,
                        RuntimeWrappedTestBody<typeof runtime, ParameterizedTestScope<TableRow>>
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<[typeof tableRuntimeBody] extends [TableTestBody<TableRow>] ? true : false, true>()
            );
            return typeScope.assert.collect();
        }),
        test('types direct resource wrappers through the resources subpath', function (typeScope) {
            const resourceBody = withResource(temporaryDirectory, function runWithScratch(scope) {
                typeScope.assert(
                    sameType<
                        IsEqual<typeof scope, ResourceTestScope<Record<'scratch', typeof temporaryDirectory>>>,
                        true
                    >()
                );
                typeScope.assert(sameType.withActual<TemporaryDirectoryHandle>(), scope.resources.scratch);

                return scope.assert.collect();
            });
            const resourcesBody = withResources({ dir: temporaryDirectory }, function runWithResources(scope) {
                typeScope.assert(
                    sameType<
                        IsEqual<typeof scope, ResourceTestScope<{ readonly dir: typeof temporaryDirectory; }>>,
                        true
                    >()
                );
                typeScope.assert(sameType.withActual<string>(), scope.resources.dir.path);
                typeScope.assert(sameType.withActual<RuntimeAttachments>(), scope.attachments);

                return scope.assert.collect();
            });

            typeScope.assert(
                sameType<
                    IsEqual<typeof resourceBody, ResourceWrappedTestBody<Record<'scratch', typeof temporaryDirectory>>>,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    IsEqual<
                        typeof resourcesBody,
                        ResourceWrappedTestBody<{ readonly dir: typeof temporaryDirectory; }>
                    >,
                    true
                >()
            );
            typeScope.assert(sameType<[typeof resourceBody] extends [TestBody] ? true : false, true>());
            typeScope.assert(sameType<[typeof resourcesBody] extends [TestBody] ? true : false, true>());
            return typeScope.assert.collect();
        }),
        test('types nested resource wrappers through explicit scope generics', function (typeScope) {
            const nestedBody = withResource(
                temporaryDirectory,
                withRuntime<typeof runtime, ResourceTestScope<Record<'scratch', typeof temporaryDirectory>>>(
                    runtime,
                    function runWithScratchAndRuntime(scope) {
                        typeScope.assert(sameType.withActual<TemporaryDirectoryHandle>(), scope.resources.scratch);
                        typeScope.assert(sameType.withActual<Database>(), scope.runtimes.api.database);
                        typeScope.assert(sameType.withActual<RuntimeAttachments>(), scope.attachments);

                        return scope.assert.collect();
                    }
                )
            );

            typeScope.assert(sameType<[typeof nestedBody] extends [TestBody] ? true : false, true>());
            return typeScope.assert.collect();
        }),
        test('accepts descriptor wrappers from neutral test authoring types', function (typeScope) {
            const runtimeBody = withRuntime(runtime, function runWithDatabase(scope) {
                return scope.assert.collect();
            });
            const resourceBody = withResource(temporaryDirectory, function runWithScratch(scope) {
                return scope.assert.collect();
            });
            const facade = createTestFacade();

            typeScope.assert(acceptsCall, () => rootTest('uses database', runtimeBody));
            typeScope.assert(acceptsCall, () => rootTest('uses scratch', resourceBody));
            typeScope.assert(acceptsCall, () => rootTest({ body: runtimeBody, title: 'uses database' }));
            typeScope.assert(acceptsCall, () => facade.test('uses database', runtimeBody));
            typeScope.assert(acceptsCall, () => facade.test('uses scratch', resourceBody));
            return typeScope.assert.collect();
        }),
        test('accepts descriptor wrappers from neutral table authoring types', function (typeScope) {
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

            typeScope.assert(acceptsCall, () =>
                rootTable({
                    cases: [ { value: 1 }, { value: 2 } ],
                    test: tableRuntimeBody,
                    title: 'rows'
                }));
            typeScope.assert(acceptsCall, () =>
                rootTable({
                    cases: [ { value: 1 }, { value: 2 } ],
                    test: tableResourceBody,
                    title: 'rows'
                }));
            typeScope.assert(acceptsCall, () =>
                facade.table({
                    cases: [ { value: 1 }, { value: 2 } ],
                    test: tableRuntimeBody,
                    title: 'rows'
                }));
            typeScope.assert(acceptsCall, () =>
                facade.table({
                    cases: [ { value: 1 }, { value: 2 } ],
                    test: tableResourceBody,
                    title: 'rows'
                }));
            return typeScope.assert.collect();
        }),
        test('accepts runtime wrappers from neutral authoring types', function (typeScope) {
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

            typeScope.assert(acceptsCall, () => facade.test('uses database', runtimeBody));
            typeScope.assert(acceptsCall, () =>
                facade.table({
                    cases: [ { value: 1 }, { value: 2 } ],
                    test: tableRuntimeBody,
                    title: 'rows'
                }));
            return typeScope.assert.collect();
        }),
        test('types facade-bound runtime resources and mapped scope', function (typeScope) {
            const facade = createTestFacade({
                runtime,
                resources: { scratch: temporaryDirectory },
                mapScope(scope) {
                    typeScope.assert(sameType.withActual<Database>(), scope.runtimes.api.database);
                    typeScope.assert(sameType.withActual<RuntimeAttachments>(), scope.attachments);
                    typeScope.assert(sameType.withActual<TemporaryDirectoryHandle>(), scope.resources.scratch);

                    return {
                        databaseUrl: scope.runtimes.api.database.url,
                        scratchPath: scope.resources.scratch.path
                    };
                }
            });

            const authoredCase = facade.test('uses facade runtime', function runWithFacade(scope) {
                typeScope.assert(sameType.withActual<string>(), scope.databaseUrl);
                typeScope.assert(sameType.withActual<string>(), scope.scratchPath);
                typeScope.assert(sameType.withActual<TemporaryDirectoryHandle>(), scope.resources.scratch);
                typeScope.assert(sameType.withActual<Database>(), scope.runtimes.api.database);
                typeScope.assert(sameType.withActual<RuntimeAttachments>(), scope.attachments);

                return scope.assert.collect();
            });
            typeScope.assert(sameType<IsEqual<typeof authoredCase, TestCase>, true>());
            const authoredTable = facade.table({
                cases: [ { value: 1 }, { value: 2 } ],
                test(scope) {
                    typeScope.assert(sameType.withActual<number>(), scope.parameters.value);
                    typeScope.assert(sameType.withActual<string>(), scope.databaseUrl);
                    typeScope.assert(sameType.withActual<string>(), scope.resources.scratch.path);

                    return scope.assert.collect();
                },
                title: 'rows'
            });
            typeScope.assert(sameType<IsEqual<typeof authoredTable, Table>, true>());
            return typeScope.assert.collect();
        })
    ]),
    test('reexports the leaf performance baseline contract', function (typeScope) {
        typeScope.assert(sameType<IsEqual<StandardBaselineAdapter, PerformanceBaselineAdapter>, true>());
        return typeScope.assert.collect();
    })
]);
