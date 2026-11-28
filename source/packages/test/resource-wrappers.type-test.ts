import type { IsEqual } from 'type-fest';
import { acceptsCall, rejectsCall, sameType } from '../type-test/type-test.entry-point.ts';
import type {
    Table,
    TestBody,
    TestCase,
    TestScope
} from '../engine/engine.entry-point.ts';
import { isAssignableTo, isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
import {
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    withResource,
    withResources,
    withRuntime,
    type ResourceTestScope,
    type RuntimeAttachments,
    type ResourceWrappedTestBody,
    type RuntimeGraph,
    type RuntimeTestScope,
    type RuntimeWrappedTestBody,
    type TemporaryDirectoryHandle
} from './resources.entry-point.ts';
import {
    createTestFacade,
    table as rootTable,
    suite,
    test,
    type ParameterizedTestScope,
    type TableTestBody
} from './test.entry-point.ts';

type Database = {
    readonly url: string;
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

declare const withRuntimeUnderTest: typeof withRuntime;

export const testNode = suite('Resource and runtime attachment wrappers', [
    test('exposes runtime test context wrappers through the resources subpath', function (scope) {
        const runtimeBody = withRuntime(runtime, function runWithDatabase(callbackScope) {
            scope.assert(sameType<IsEqual<typeof callbackScope, RuntimeTestScope<typeof runtime>>, true>());
            scope.assert(sameType.withActual<true>(), isEqualTo<Database>()(callbackScope.runtimes.api.database));
            scope.assert(sameType.withActual<true>(), isEqualTo<RuntimeAttachments>()(callbackScope.attachments));

            return callbackScope.assert.collect();
        });

        scope.assert(sameType.withActual<true>(), isEqualTo<RuntimeWrappedTestBody<typeof runtime>>()(runtimeBody));
        scope.assert(sameType<[typeof runtimeBody] extends [TestBody] ? true : false, true>());
        scope.assert(sameType<IsAssignable<typeof runtime, RuntimeGraph>, true>());
        scope.assert(rejectsCall('argument-count'), function () {
            return withRuntimeUnderTest(runtime, {
                database: { url: 'postgres://localhost' }
            }, function runInvalidRuntimeScope(callbackScope: TestScope) {
                return callbackScope.assert.collect();
            });
        });
        return scope.assert.collect();
    }),
    test('types table runtime wrappers through the resources subpath', function (scope) {
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
            runtime,
            function runTableWithDatabase(callbackScope) {
                scope.assert(
                    sameType<
                        IsEqual<
                            typeof callbackScope,
                            RuntimeTestScope<typeof runtime, ParameterizedTestScope<TableRow>>
                        >,
                        true
                    >()
                );
                scope.assert(sameType.withActual<number>(), callbackScope.parameters.value);
                scope.assert(sameType.withActual<string>(), callbackScope.runtimes.api.database.url);

                return callbackScope.assert.collect();
            }
        );

        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<RuntimeWrappedTestBody<typeof runtime, ParameterizedTestScope<TableRow>>>()(tableRuntimeBody)
        );
        scope.assert(
            sameType<[typeof tableRuntimeBody] extends [TableTestBody<TableRow>] ? true : false, true>()
        );
        return scope.assert.collect();
    }),
    test('types direct resource wrappers through the resources subpath', function (scope) {
        const resourceBody = withResource(temporaryDirectory, function runWithScratch(callbackScope) {
            scope.assert(
                sameType<
                    IsEqual<typeof callbackScope, ResourceTestScope<Record<'scratch', typeof temporaryDirectory>>>,
                    true
                >()
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TemporaryDirectoryHandle>()(callbackScope.resources.scratch)
            );

            return callbackScope.assert.collect();
        });
        const resourcesBody = withResources({ dir: temporaryDirectory }, function runWithResources(callbackScope) {
            scope.assert(
                sameType<
                    IsEqual<typeof callbackScope, ResourceTestScope<{ readonly dir: typeof temporaryDirectory; }>>,
                    true
                >()
            );
            scope.assert(sameType.withActual<string>(), callbackScope.resources.dir.path);
            scope.assert(sameType.withActual<true>(), isEqualTo<RuntimeAttachments>()(callbackScope.attachments));

            return callbackScope.assert.collect();
        });

        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<ResourceWrappedTestBody<Record<'scratch', typeof temporaryDirectory>>>()(resourceBody)
        );
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<ResourceWrappedTestBody<{ readonly dir: typeof temporaryDirectory; }>>()(resourcesBody)
        );
        scope.assert(sameType<[typeof resourceBody] extends [TestBody] ? true : false, true>());
        scope.assert(sameType<[typeof resourcesBody] extends [TestBody] ? true : false, true>());
        return scope.assert.collect();
    }),
    test('types nested resource wrappers through explicit scope generics', function (scope) {
        const nestedBody = withResource(
            temporaryDirectory,
            withRuntime<typeof runtime, ResourceTestScope<Record<'scratch', typeof temporaryDirectory>>>(
                runtime,
                function runWithScratchAndRuntime(callbackScope) {
                    scope.assert(
                        sameType.withActual<true>(),
                        isEqualTo<TemporaryDirectoryHandle>()(callbackScope.resources.scratch)
                    );
                    scope.assert(
                        sameType.withActual<true>(),
                        isEqualTo<Database>()(callbackScope.runtimes.api.database)
                    );
                    scope.assert(
                        sameType.withActual<true>(),
                        isEqualTo<RuntimeAttachments>()(callbackScope.attachments)
                    );

                    return callbackScope.assert.collect();
                }
            )
        );

        scope.assert(sameType.withActual<true>(), isAssignableTo<TestBody>()(nestedBody));
        return scope.assert.collect();
    }),
    test('accepts descriptor wrappers from neutral test authoring types', function (scope) {
        const runtimeBody = withRuntime(runtime, function runWithDatabase(callbackScope) {
            return callbackScope.assert.collect();
        });
        const resourceBody = withResource(temporaryDirectory, function runWithScratch(callbackScope) {
            return callbackScope.assert.collect();
        });
        const facade = createTestFacade();

        scope.assert(acceptsCall, function () {
            return test('uses database', runtimeBody);
        });
        scope.assert(acceptsCall, function () {
            return test('uses scratch', resourceBody);
        });
        scope.assert(acceptsCall, function () {
            return test({ body: runtimeBody, title: 'uses database' });
        });
        scope.assert(acceptsCall, function () {
            return facade.test('uses database', runtimeBody);
        });
        scope.assert(acceptsCall, function () {
            return facade.test('uses scratch', resourceBody);
        });
        return scope.assert.collect();
    }),
    test('accepts descriptor wrappers from neutral table authoring types', function (scope) {
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
            runtime,
            function runTableWithDatabase(callbackScope) {
                return callbackScope.assert.collect();
            }
        );
        const tableResourceBody = withResource<typeof temporaryDirectory, ParameterizedTestScope<TableRow>>(
            temporaryDirectory,
            function runTableWithScratch(callbackScope) {
                return callbackScope.assert.collect();
            }
        );
        const facade = createTestFacade();

        scope.assert(acceptsCall, function () {
            return rootTable({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableRuntimeBody,
                title: 'rows'
            });
        });
        scope.assert(acceptsCall, function () {
            return rootTable({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableResourceBody,
                title: 'rows'
            });
        });
        scope.assert(acceptsCall, function () {
            return facade.table({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableRuntimeBody,
                title: 'rows'
            });
        });
        scope.assert(acceptsCall, function () {
            return facade.table({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableResourceBody,
                title: 'rows'
            });
        });
        return scope.assert.collect();
    }),
    test('accepts runtime wrappers from neutral authoring types', function (scope) {
        const runtimeBody = withRuntime(runtime, function runWithDatabase(callbackScope) {
            return callbackScope.assert.collect();
        });
        const tableRuntimeBody = withRuntime<typeof runtime, ParameterizedTestScope<TableRow>>(
            runtime,
            function runTableWithDatabase(callbackScope) {
                return callbackScope.assert.collect();
            }
        );
        const facade = createTestFacade();

        scope.assert(acceptsCall, function () {
            return facade.test('uses database', runtimeBody);
        });
        scope.assert(acceptsCall, function () {
            return facade.table({
                cases: [ { value: 1 }, { value: 2 } ],
                test: tableRuntimeBody,
                title: 'rows'
            });
        });
        return scope.assert.collect();
    }),
    test('types facade-bound runtime resources and mapped scope', function (scope) {
        const facade = createTestFacade({
            runtime,
            resources: { scratch: temporaryDirectory },
            mapScope(callbackScope) {
                scope.assert(sameType.withActual<true>(), isEqualTo<Database>()(callbackScope.runtimes.api.database));
                scope.assert(sameType.withActual<true>(), isEqualTo<RuntimeAttachments>()(callbackScope.attachments));
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<TemporaryDirectoryHandle>()(callbackScope.resources.scratch)
                );

                return {
                    databaseUrl: callbackScope.runtimes.api.database.url,
                    scratchPath: callbackScope.resources.scratch.path
                };
            }
        });

        const authoredCase = facade.test('uses facade runtime', function runWithFacade(callbackScope) {
            scope.assert(sameType.withActual<string>(), callbackScope.databaseUrl);
            scope.assert(sameType.withActual<string>(), callbackScope.scratchPath);
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<TemporaryDirectoryHandle>()(callbackScope.resources.scratch)
            );
            scope.assert(sameType.withActual<true>(), isEqualTo<Database>()(callbackScope.runtimes.api.database));
            scope.assert(sameType.withActual<true>(), isEqualTo<RuntimeAttachments>()(callbackScope.attachments));

            return callbackScope.assert.collect();
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(authoredCase));
        const authoredTable = facade.table({
            cases: [ { value: 1 }, { value: 2 } ],
            test(callbackScope) {
                scope.assert(sameType.withActual<number>(), callbackScope.parameters.value);
                scope.assert(sameType.withActual<string>(), callbackScope.databaseUrl);
                scope.assert(sameType.withActual<string>(), callbackScope.resources.scratch.path);

                return callbackScope.assert.collect();
            },
            title: 'rows'
        });
        scope.assert(sameType.withActual<true>(), isEqualTo<Table>()(authoredTable));
        return scope.assert.collect();
    })
]);
