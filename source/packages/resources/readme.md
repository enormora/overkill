# `@overkill-dev/resources`

Typed resource and runtime descriptors for Overkill.

This package defines resources as inert values. A resource declares its stable
name, lifecycle scope, execution requirements, dependencies, acquisition
callback, and disposal callback. Runners do not execute these descriptors yet.

```ts
import {
    composeRuntimeContext,
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

const databaseHandle = await database.acquire({ resources: {}, signal });
const serverHandle = await server.acquire({
    resources: { database: databaseHandle },
    signal
});
const scopeWithRuntime = composeRuntimeContext(testScope, runtime, {
    database: databaseHandle,
    server: serverHandle
});
```

`RuntimeContext` uses the keys from the runtime's `resources` object. Resource
`name` remains the stable identity used by reporters, artifacts, and future
scheduling work.

Dependency context uses the keys from the resource's `dependencies` object.
Omitting `dependencies` is accepted for compatibility and produces
`dependencies: {}` on the returned descriptor.
