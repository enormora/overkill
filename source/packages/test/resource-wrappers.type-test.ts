import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { acceptsCall, assignableFrom, rejectsCall, sameType } from '@overkill-dev/type-test';
import type {
    Table,
    TestBody,
    TestCase,
    TestScope
} from '../engine/engine.entry-point.ts';
import { isAssignableTo, isEqualTo } from '../../test-support/type-relations.ts';
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
    test as rootTest,
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

export const testNode = suite('@overkill-dev/test/resources wrapper standard subpath', [
    test('exposes runtime test context wrappers through the resources subpath', function (typeScope) {
        const runtimeBody = withRuntime(runtime, function runWithDatabase(scope) {
            typeScope.assert(sameType<IsEqual<typeof scope, RuntimeTestScope<typeof runtime>>, true>());
            typeScope.assert(sameType.withActual<Database>(), scope.runtimes.api.database);
            typeScope.assert(sameType.withActual<RuntimeAttachments>(), scope.attachments);

            return scope.assert.collect();
        });

        typeScope.assert(sameType.withActual<true>(), isEqualTo<RuntimeWrappedTestBody<typeof runtime>>()(runtimeBody));
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
            sameType.withActual<true>(),
            isEqualTo<RuntimeWrappedTestBody<typeof runtime, ParameterizedTestScope<TableRow>>>()(tableRuntimeBody)
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
            sameType.withActual<true>(),
            isEqualTo<ResourceWrappedTestBody<Record<'scratch', typeof temporaryDirectory>>>()(resourceBody)
        );
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<ResourceWrappedTestBody<{ readonly dir: typeof temporaryDirectory; }>>()(resourcesBody)
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

        typeScope.assert(sameType.withActual<true>(), isAssignableTo<TestBody>()(nestedBody));
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
        typeScope.assert(sameType.withActual<true>(), isEqualTo<TestCase>()(authoredCase));
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
        typeScope.assert(sameType.withActual<true>(), isEqualTo<Table>()(authoredTable));
        return typeScope.assert.collect();
    })
]);
