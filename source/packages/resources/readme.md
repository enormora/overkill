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
whose handle exposes `path` and an empty `transcript`. Each acquisition creates
a unique directory with an Overkill prefix. Disposal removes that directory
recursively.

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
typed object handle. Its handle also exposes a read-only `transcript`. Recording
is enabled by default and stores one normalized `http` entry per completed
exchange. Request and response bodies are captured up to 16 KiB independently.
External clients still produce request metadata and a response whose body is
marked unavailable. Pass `{ kind: 'disabled' }` as the second argument to turn
recording off, or `{ kind: 'custom', transcript(server) { ... } }` to supply a
protocol-specific transcript.

Runner-managed handles show transcript entries from the active test case.
Handles returned by `startResources(...)` and `startRuntime(...)` show the full
resource lifetime.

`createLocalProcessServiceResource(...)` starts a child process, drains bounded
stdout/stderr lifecycle buffers, waits for explicit readiness, and terminates
then force-kills during disposal according to the declared shutdown contract.
Output buffers are lifecycle diagnostics. Attach them explicitly when a run
should retain them as artifacts.

Runner-managed acquisition, disposal, handle projection, and scenario exposure
contexts include `attachments`. Resource and runtime test wrappers also expose
`scope.attachments`:

```typescript
const log = await scope.attachments.open({
    kind: 'text',
    name: 'service-log',
    mediaType: 'text/plain'
});
await log.write('Service ready\n');
await log.close();
await scope.attachments.json(
    { name: 'accessibility', mediaType: 'application/json' },
    { violations: [] }
);
await scope.attachments.file(
    { name: 'screenshot', mediaType: 'image/png' },
    screenshotPath
);
```

Await each write and close every writer. Binary writers accept `Uint8Array`.
Text byte chunks must contain valid UTF-8.
`file(...)` copies a file before resolving, so resource teardown may remove the
original. Text and JSON remain inline; binary data lives in runner-owned files.
JSON preserves the supplied schema and rejects values that JSON serialization
would silently change, including cycles, accessors, and non-finite numbers.

Opening a writer fixes its case and attempt owner. Calls outside an active case
produce run artifacts. Setup and teardown outside a case therefore remain run scoped. A call from an expired attempt fails with `attribution-drift`.
Unclosed writers and binary overflow retain their available prefix and fail the
run. Text truncates; oversized JSON produces an omission record.

Attachments require runner-managed integration execution. Standalone
`startResources(...)` and `startRuntime(...)` sessions reject attachment calls.

`@overkill-dev/resources/attachment-context` exposes the shared context bridge
for runner and authoring integrations. Test authors should use `scope.attachments`.
Service transcripts and logs are retained only when explicitly attached.

Resources may declare finite scenario slots with a default, timing, and allowed
values. `defineRuntime(...)` lifts slots from its complete dependency graph.
`runtime.scenario({...})` applies partial overrides, while omitted slots retain
their current value or declared default. Acquisition and disposal callbacks
receive acquire-timed values through `context.scenarios`. Those values form
part of the resource cache key.

Every resolved slot, including a default, is recorded in `runtime.id.scenarios`.
Catalogs do not expand into additional work. Only explicit `.scenario({...})`
bindings select non-default values.

Request-routed slots require `exposeHandle(handle, context)`. The callback
receives only request-routed values and returns the handle view for that use.
Different routed bindings reuse one acquired owner handle. A dependent
resource still acquires separately when those views differ.

`createSimulatedHttpServerResource({ simulation, address })` starts a simulated
HTTP server from `@overkill-dev/simulation` as a per-case resource. Its
request-routed scenario slot uses the simulation name. A runtime binding makes
`baseUrl` select that scenario, while `scenarioUrl(...)` remains available for
explicit URL selection. Its transcript records the selected scenario and omits
the internal scenario query parameter from the request URL.

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
`affinity-key`, `fault-domain`, `duplicate-execution`, and
`startup-budget-milliseconds`. `duplicate-execution` declares that a resource
or runtime makes work safe to duplicate as `idempotent` or
`disposable-isolated`; the runner still decides whether the active execution
envelope is strong enough to hedge.
