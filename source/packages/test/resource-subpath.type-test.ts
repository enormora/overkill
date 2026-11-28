import type { Except, IsEqual, ReadonlyKeysOf, Simplify } from 'type-fest';
import { sameType } from '@overkill-dev/type-test';
import type {
    TestScope
} from '../engine/engine.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
import { suite, test } from '@overkill-dev/test';
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

export const testNode = suite('Resource and runtime authoring exports', [
    test('exposes resource descriptor types through the standard distribution', function (scope) {
        scope.assert(sameType<IsEqual<ResourceHandle<typeof database>, Database>, true>());
        scope.assert(
            sameType<IsEqual<ResourceHandle<typeof temporaryDirectory>, TemporaryDirectoryHandle>, true>()
        );
        scope.assert(sameType<IsEqual<ResourceContext<typeof runtime.resources>, DatabaseContext>, true>());
        scope.assert(sameType<
            IsEqual<ResourceScopeContext<{ readonly dir: typeof temporaryDirectory; }>, {
                readonly dir: TemporaryDirectoryHandle;
            }>,
            true
        >());
        scope.assert(sameType.withActual<'scratch'>(), temporaryDirectory.name);
        scope.assert(sameType<
            IsEqual<TemporaryDirectoryHandle, {
                readonly path: string;
                readonly transcript: TranscriptView<never>;
            }>,
            true
        >());
        return scope.assert.collect();
    }),
    test('exposes runtime descriptor types through the standard distribution', function (scope) {
        scope.assert(sameType<
            IsEqual<RuntimeContext<typeof runtime>, {
                readonly database: Database;
            }>,
            true
        >());
        scope.assert(sameType<
            IsEqual<RuntimeScopeContext<typeof runtime>, {
                readonly api: {
                    readonly database: Database;
                };
            }>,
            true
        >());
        scope.assert(sameType.withActual<'api'>(), runtime.name);
        return scope.assert.collect();
    }),
    test('exposes projected resource descriptor types through the standard distribution', function (scope) {
        scope.assert(sameType<IsEqual<ResourceHandle<typeof projectedDatabase>, ProjectedDatabase>, true>());
        scope.assert(sameType.withActual<'projected-database'>(), projectedDatabase.name);
        return scope.assert.collect();
    }),
    test('exposes resource lifecycle types through the standard distribution', function (scope) {
        scope.assert(
            sameType.withActual<true>(),
            isEqualTo<Promise<RuntimeSession<typeof runtime>>>()(
                startRuntime({ runtime, signal: typeTestController.signal })
            )
        );
        scope.assert(sameType<IsAssignable<ResourceLifecycleError, Error>, true>());
        const composedContext = composeRuntimeContext(testScope, runtime, {
            database: { url: 'postgres://localhost' }
        });
        scope.assert(
            sameType<IsEqual<Simplify<Except<typeof composedContext, 'runtimes'>>, Simplify<TestScope>>, true>()
        );
        scope.assert(sameType<
            IsEqual<Simplify<typeof composedContext.runtimes>, ExpectedComposedRuntimeScope['runtimes']>,
            true
        >());
        scope.assert(sameType<
            IsEqual<ReadonlyKeysOf<typeof composedContext>, ReadonlyKeysOf<ExpectedComposedRuntimeScope>>,
            true
        >());
        scope.assert(sameType.withActual<true>(), isEqualTo<DatabaseContext>()(composedContext.runtimes.api));
        scope.assert(
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
        return scope.assert.collect();
    })
]);
