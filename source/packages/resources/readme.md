# `@overkill-dev/resources`

Typed resource and runtime lifecycle composition for Overkill.

This package defines resources as values and can start an explicit runtime
session from them. A resource declares its stable name, lifecycle scope,
execution requirements, dependencies, acquisition callback, and disposal
callback.

```ts
import {
    composeRuntimeContext,
    composeRuntimes,
    createLocalHttpServiceResource,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    startResources,
    startRuntime,
    type ResourceContext,
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

const app = createLocalHttpServiceResource({
    name: 'app',
    scope: 'per-case',
    requirements: [],
    dependencies: { database },
    address: { kind: 'loopback', port: 0 },
    createServer(context) {
        return createAppServer({ database: context.dependencies.database });
    },
    handle(service) {
        return { baseUrl: service.baseUrl };
    },
    dispose() {
        return undefined;
    }
});

const scratch = createTemporaryDirectoryResource('scratch');
const sharedDatabase = defineResource({
    name: 'shared-database',
    scope: 'per-run',
    requirements: [ { kind: 'single-worker' } ],
    async acquire(context) {
        context.signal.throwIfAborted();

        return await openDatabase();
    },
    deserializeHandle(payload) {
        return { url: payload.url };
    },
    async dispose(database) {
        await database.close();
    },
    serializeHandle(database) {
        return { url: database.url };
    }
});
const runtime = defineRuntime({
    name: 'api',
    dimensions: {},
    resources: { app, database, server, scratch },
    requirements: [ { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 } ]
});

type ApiContext = RuntimeContext<typeof runtime>;
type ScratchContext = ResourceContext<{ readonly scratch: typeof scratch; }>;

await using session = await startRuntime({ runtime, signal });

const scopeWithRuntime = composeRuntimeContext(testScope, runtime, session.context);
scopeWithRuntime.runtimes.api.database;

await using resources = await startResources({ resources: { scratch }, signal });
resources.context.scratch.path;
```

`RuntimeContext` uses the keys from the runtime's `resources` object. Resource
`name` remains the stable identity used by reporters, artifacts, and future
scheduling work.

`composeRuntimeContext(...)` exposes acquired handles under
`scope.runtimes.<runtimeName>`, such as `scope.runtimes.api`.
`composeRuntimes(...)` combines leaf runtimes and runtime matrices into one
graph while exposing each child under its own public runtime name.

Dependency context uses the keys from the resource's `dependencies` object.
Omitting `dependencies` is accepted for compatibility and produces
`dependencies: {}` on the returned descriptor.

`createTemporaryDirectoryResource(name)` returns a per-case resource descriptor
whose handle is `{ readonly path: string }`. Each acquisition creates a unique
directory with an Overkill prefix. Disposal removes that directory recursively.

`defineLocalServiceResource(...)` models owned local services with explicit
`start`, `ready`, and `dispose` phases. Callers declare scope, requirements,
dependencies, and an explicit address request such as
`{ kind: 'loopback', port: 0 }`. `start` owns the service internals, `ready`
returns the object handle exposed to tests, and `dispose` receives only the
owner state. If readiness fails, the owner is disposed before acquisition
fails. Projected scopes use the same serialize and deserialize rules as
ordinary resources.

`createLocalHttpServiceResource(...)` owns HTTP `listen` and `close`, exposes
the actual loopback endpoint and `baseUrl`, and lets callers map that into a
typed object handle. `createLocalProcessServiceResource(...)` starts a child
process, drains bounded stdout/stderr lifecycle buffers, waits for explicit
readiness, and terminates then force-kills during disposal according to the
declared shutdown contract. Output buffers are lifecycle diagnostics, not
artifacts.

`createSimulatedHttpServerResource({ simulation, address })` starts a simulated
HTTP server from `@overkill-dev/simulation` as a per-case resource. The
acquired handle exposes `baseUrl` for the `default` scenario and
`scenarioUrl(...)` for URL-selected scenarios.

`startRuntime(...)` acquires dependencies before dependents, shares one handle
per descriptor inside the session, and disposes acquired resources once in
reverse dependency order. Independent ready resources may acquire concurrently.

`startResources(...)` starts a direct resource session without wrapping the
handles in a runtime name. It uses the keys from the provided resource map and
the same acquisition, sharing, and disposal behavior as `startRuntime(...)`.

The package-level session API starts one explicit session and therefore shares
one handle per descriptor inside that session. Runner-managed wrappers in
`@overkill-dev/test/resources` interpret `scope` as `per-run`, `per-file`,
`per-suite`, `per-case`, or `shared-per-worker` lifetime boundaries.

`per-run` resources must define `serializeHandle(...)` and
`deserializeHandle(...)` so runner-owned resources can be projected into
consumer execution contexts. `per-file` and `per-suite` resources may also
define projection hooks when their owner handle is not the same value that
test code should consume. `per-case` and `shared-per-worker` resources are
local to their execution owner and do not use projection hooks.

Execution requirements describe placement pressure for the runner:
`serial`, `single-worker`, `exclusive-resource`, `capacity-weight`,
`affinity-key`, `fault-domain`, and `startup-budget-milliseconds`.
