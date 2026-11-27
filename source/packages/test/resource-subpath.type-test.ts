import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { assignableTo, sameType } from '@overkill-dev/type-test';
import type {
    TestScope
} from '../engine/engine.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    composeRuntimeContext,
    composeRuntimes,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    type ResourceLifecycleError,
    startRuntime,
    type ResourceContext,
    type ResourceHandle,
    type ResourceScopeContext,
    type RuntimeSession,
    type RuntimeContext,
    type RuntimeScopeContext,
    type TemporaryDirectoryHandle,
    type TranscriptView
} from './resources.entry-point.ts';

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

export const testNode = suite('@overkill-dev/test/resources standard subpath', [
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
]);
