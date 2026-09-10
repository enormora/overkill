# `@overkill-dev/resources`

Typed resource and runtime lifecycle composition for Overkill.

This package defines resources as values and can start an explicit runtime
session from them. A resource declares its stable name, lifecycle scope,
execution requirements, dependencies, acquisition callback, and disposal
callback.

```ts
import {
    composeRuntimeContext,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    startRuntime,
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
        return await startServer(context.dependencies.database);
    },
    async dispose(server, context) {
        await server.stop(context.dependencies.database);
    }
});

const scratch = createTemporaryDirectoryResource('scratch');
const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { database, server, scratch },
    requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ]
});

type ApiContext = RuntimeContext<typeof runtime>;

await using session = await startRuntime({ runtime, signal });

const scopeWithRuntime = composeRuntimeContext(testScope, runtime, session.context);
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

`startRuntime(...)` acquires dependencies before dependents, shares one handle
per descriptor inside the session, and disposes acquired resources once in
reverse dependency order. Independent ready resources may acquire concurrently.

`scope` and `requirements` are metadata in this package-level session API.
Runner-managed per-run, per-file, per-suite, per-case, and shared-per-worker
lifetimes are planned separately.
