import type { Except, IsEqual, ReadonlyKeysOf, Simplify } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import type {
    TestScope
} from '../engine/engine.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
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
        typeScope.assert(sameType<IsEqual<ResourceHandle<typeof database>, Database>, true>());
        typeScope.assert(
            sameType<IsEqual<ResourceHandle<typeof temporaryDirectory>, TemporaryDirectoryHandle>, true>()
        );
        typeScope.assert(sameType<IsEqual<ResourceContext<typeof runtime.resources>, DatabaseContext>, true>());
        typeScope.assert(sameType<
            IsEqual<ResourceScopeContext<{ readonly dir: typeof temporaryDirectory; }>, {
                readonly dir: TemporaryDirectoryHandle;
            }>,
            true
        >());
        typeScope.assert(sameType.withActual<'scratch'>(), temporaryDirectory.name);
        typeScope.assert(sameType<
            IsEqual<TemporaryDirectoryHandle, {
                readonly path: string;
                readonly transcript: TranscriptView<never>;
            }>,
            true
        >());
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
        typeScope.assert(sameType<IsEqual<ResourceHandle<typeof projectedDatabase>, ProjectedDatabase>, true>());
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
        typeScope.assert(sameType<IsAssignable<ResourceLifecycleError, Error>, true>());
        const composedContext = composeRuntimeContext(testScope, runtime, {
            database: { url: 'postgres://localhost' }
        });
        typeScope.assert(
            sameType<IsEqual<Simplify<Except<typeof composedContext, 'runtimes'>>, Simplify<TestScope>>, true>()
        );
        typeScope.assert(sameType<
            IsEqual<Simplify<typeof composedContext.runtimes>, ExpectedComposedRuntimeScope['runtimes']>,
            true
        >());
        typeScope.assert(sameType<
            IsEqual<ReadonlyKeysOf<typeof composedContext>, ReadonlyKeysOf<ExpectedComposedRuntimeScope>>,
            true
        >());
        typeScope.assert(sameType.withActual<true>(), isEqualTo<DatabaseContext>()(composedContext.runtimes.api));
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
