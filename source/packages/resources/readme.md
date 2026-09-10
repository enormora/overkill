# `@overkill-dev/resources`

Typed resource and runtime descriptors for Overkill.

This package defines resources as typed descriptors. A resource declares its
stable name, lifecycle scope, execution requirements, dependencies,
acquisition callback, and disposal callback.

```ts
import {
    composeRuntimeContext,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    type RuntimeContext
} from '@overkill-dev/resources';

const database = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [ { kind: 'exclusive-resource', name: 'database' } ],
    dependencies: {},
    async acquire(context) {
        context.signal.throwIfAborted();

        return await openDatabase();
    },
    async dispose(database, _context) {
        await database.close();
    }
});

const server = defineResource({
    name: 'server',
    scope: 'per-case',
    requirements: [],
    dependencies: { database },
    async acquire(context) {
        return await startServer(context.resources.database);
    },
    async dispose(server, context) {
        await server.stop(context.resources.database);
    }
});

const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { database, server },
    requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ]
});

type ApiContext = RuntimeContext<typeof runtime>;

const scratch = createTemporaryDirectoryResource('scratch');
const databaseHandle = await database.acquire({ resources: {}, signal });
const serverHandle = await server.acquire({
    resources: { database: databaseHandle },
    signal
});
const scratchHandle = await scratch.acquire({ resources: {}, signal });
const scopeWithRuntime = composeRuntimeContext(testScope, runtime, {
    database: databaseHandle,
    server: serverHandle
});

if (scratch.dispose !== null) {
    await scratch.dispose(scratchHandle, { resources: {}, signal });
}
```

`RuntimeContext` uses the keys from the runtime's `resources` object. Resource
`name` remains the stable identity used by reporters, artifacts, and future
scheduling work.

Dependency context uses the keys from the resource's `dependencies` object.
Omitting `dependencies` is accepted for compatibility and produces
`dependencies: {}` on the returned descriptor.

`createTemporaryDirectoryResource(name)` returns a per-case resource descriptor
whose handle is `{ readonly path: string }`. Each acquisition creates a unique
directory with an Overkill prefix. Disposal removes that directory recursively.
