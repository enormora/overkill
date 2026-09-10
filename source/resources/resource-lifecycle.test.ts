import { createSuite, createTestCase, type TestNode, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defineResource,
    defineRuntime,
    type EmptyResourceDependencies,
    type ResourceDefinition,
    type RuntimeDefinition
} from './resources.ts';
import { ResourceLifecycleError, startRuntime, type StartRuntimeRequest } from './runtime-lifecycle.ts';

type Database = {
    readonly query: (sql: string) => readonly string[];
};
type Server = {
    readonly results: readonly string[];
};
type EventLog = {
    readonly add: (...events: readonly string[]) => void;
    readonly values: () => readonly string[];
};
type Deferred<Value> = {
    readonly promise: Promise<Value>;
    readonly reject: (cause: unknown) => void;
    readonly resolve: (value: Value) => void;
};
type DatabaseResource = ResourceDefinition<'database', Database, EmptyResourceDependencies>;
type ServerDependencies = { readonly database: DatabaseResource; };
type RuntimeRequest = StartRuntimeRequest<RuntimeDefinition>;
type SharedDependencyScenario = {
    readonly acquisitions: () => number;
    readonly database: Database;
    readonly events: EventLog;
    readonly runtime: RuntimeDefinition;
};
type AcquireFailureScenario = {
    readonly acquireError: Error;
    readonly disposeError: Error;
    readonly events: EventLog;
    readonly runtime: RuntimeDefinition;
};
type DisposalFailureScenario = {
    readonly events: EventLog;
    readonly firstDisposeError: Error;
    readonly runtime: RuntimeDefinition;
    readonly secondDisposeError: Error;
};
type Failure = {
    readonly cause: unknown;
    readonly phase: string;
    readonly resourceName: string;
};
type GraphFailure = {
    readonly phase: string;
    readonly resourceName: string;
};

function createEventLog(): EventLog {
    const events: string[] = [];

    return {
        add(...newEvents) {
            events.push(...newEvents);
        },
        values() {
            return Array.from(events);
        }
    };
}

function deferred<Value>(): Deferred<Value> {
    let resolvePromise: (value: Value) => void = function resolveBeforeAssignment(): void {
        throw new Error('Deferred promise was not initialized.');
    };
    let rejectPromise: (cause: unknown) => void = function rejectBeforeAssignment(): void {
        throw new Error('Deferred promise was not initialized.');
    };
    const promise = new Promise<Value>(function assignPromiseCallbacks(resolve, reject) {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    return {
        promise,
        reject: rejectPromise,
        resolve: resolvePromise
    };
}

function createDatabase(): Database {
    return {
        query(sql: string) {
            return [ sql ];
        }
    };
}

function testSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function compareText(left: string, right: string): number {
    return left.localeCompare(right);
}

function lifecycleEvents(): readonly string[] {
    return [
        'database signal',
        'database acquire',
        'server',
        'server acquire',
        'server dispose',
        'database dispose signal',
        'database dispose'
    ];
}

function failureSummary(failure: Failure): readonly unknown[] {
    return [ failure.phase, failure.resourceName, failure.cause ];
}

function graphFailureSummary(failure: GraphFailure): readonly string[] {
    return [ failure.phase, failure.resourceName ];
}

function runtimeLifecycleDatabase(events: EventLog): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(context): Database {
            events.add(context.signal.aborted ? 'database aborted signal' : 'database signal', 'database acquire');

            return createDatabase();
        },
        dispose() {
            events.add('database dispose signal', 'database dispose');
        }
    });
}

function runtimeLifecycleServer(
    events: EventLog,
    database: DatabaseResource
): ResourceDefinition<'server', Server, ServerDependencies> {
    return defineResource({
        name: 'server',
        scope: 'per-case',
        requirements: [],
        dependencies: { database },
        acquire(context): Server {
            events.add(context.dependencies.database.query('server')[0] ?? 'missing', 'server acquire');

            return { results: [ 'ready' ] };
        },
        dispose() {
            events.add('server dispose');
        }
    });
}

function sharedDatabase(events: EventLog, recordAcquisition: () => void, database: Database): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'shared-per-worker',
        requirements: [],
        acquire(): Database {
            recordAcquisition();

            return database;
        },
        dispose() {
            events.add('database dispose');
        }
    });
}

function sharedServer(
    events: EventLog,
    database: DatabaseResource,
    name: 'server' | 'worker'
): ResourceDefinition<'server' | 'worker', Server, ServerDependencies> {
    return defineResource({
        name,
        scope: 'per-case',
        requirements: [],
        dependencies: { database },
        acquire(context): Server {
            events.add(context.dependencies.database.query(name)[0] ?? 'missing');

            return { results: [ name ] };
        },
        dispose() {
            events.add(`${name} dispose`);
        }
    });
}

function sharedDependencyScenario(): SharedDependencyScenario {
    let acquisitions = 0;
    const database = createDatabase();
    const events = createEventLog();
    const databaseResource = sharedDatabase(events, function recordAcquisition() {
        acquisitions += 1;
    }, database);
    const runtime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: {
            server: sharedServer(events, databaseResource, 'server'),
            store: databaseResource,
            worker: sharedServer(events, databaseResource, 'worker')
        },
        requirements: []
    });

    return {
        acquisitions: function acquisitionCount() {
            return acquisitions;
        },
        database,
        events,
        runtime
    };
}

function slowResource(
    events: EventLog,
    gate: Deferred<undefined>
): ResourceDefinition<'slow', string, EmptyResourceDependencies> {
    return defineResource({
        name: 'slow',
        scope: 'per-case',
        requirements: [],
        async acquire(): Promise<string> {
            events.add('slow start');
            await gate.promise;
            events.add('slow done');

            return 'slow';
        },
        dispose: null
    });
}

function fastResource(events: EventLog): ResourceDefinition<'fast', string, EmptyResourceDependencies> {
    return defineResource({
        name: 'fast',
        scope: 'per-case',
        requirements: [],
        acquire(): string {
            events.add('fast start');

            return 'fast';
        },
        dispose: null
    });
}

function failureDatabase(events: EventLog, disposeError: Error): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(): Database {
            events.add('database acquire');

            return createDatabase();
        },
        dispose() {
            events.add('database dispose');
            throw disposeError;
        }
    });
}

function failureServer(events: EventLog, database: DatabaseResource, acquireError: Error): ResourceDefinition<
    'server',
    Server,
    ServerDependencies
> {
    return defineResource({
        name: 'server',
        scope: 'per-case',
        requirements: [],
        dependencies: { database },
        acquire(): Server {
            events.add('server acquire');
            throw acquireError;
        },
        dispose: null
    });
}

function acquireFailureScenario(): AcquireFailureScenario {
    const events = createEventLog();
    const acquireError = new Error('server failed');
    const disposeError = new Error('database dispose failed');
    const database = failureDatabase(events, disposeError);
    const server = failureServer(events, database, acquireError);
    const runtime = defineRuntime({ name: 'api', dimensions: {}, resources: { server }, requirements: [] });

    return { acquireError, disposeError, events, runtime };
}

function disposableResource(
    name: 'first' | 'second',
    events: EventLog,
    disposeError: Error
): ResourceDefinition<'first' | 'second', string, EmptyResourceDependencies> {
    return defineResource({
        name,
        scope: 'per-case',
        requirements: [],
        acquire(): string {
            return name;
        },
        dispose() {
            events.add(`${name} dispose`);
            throw disposeError;
        }
    });
}

function disposalFailureScenario(): DisposalFailureScenario {
    const firstDisposeError = new Error('first dispose failed');
    const secondDisposeError = new Error('second dispose failed');
    const events = createEventLog();
    const runtime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: {
            first: disposableResource('first', events, firstDisposeError),
            second: disposableResource('second', events, secondDisposeError)
        },
        requirements: []
    });

    return { events, firstDisposeError, runtime, secondDisposeError };
}

function graphDatabase(): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire: createDatabase,
        dispose: null
    });
}

function duplicateRuntimeRequest(): RuntimeRequest {
    const firstDatabase = graphDatabase();
    const secondDatabase = graphDatabase();

    return {
        runtime: defineRuntime({
            name: 'duplicate',
            dimensions: {},
            resources: { firstDatabase, secondDatabase },
            requirements: []
        }),
        signal: testSignal()
    };
}

function cycleRuntimeRequest(): RuntimeRequest {
    type CycleDependencies = {
        readonly self: ResourceDefinition<'cycle', string, CycleDependencies>;
    };
    const cycleResource: ResourceDefinition<'cycle', string, CycleDependencies> = defineResource({
        name: 'cycle',
        scope: 'per-case',
        requirements: [],
        dependencies: {
            get self(): ResourceDefinition<'cycle', string, CycleDependencies> {
                return cycleResource;
            }
        },
        acquire() {
            return 'cycle';
        },
        dispose: null
    });

    return {
        runtime: defineRuntime({
            name: 'cycle',
            dimensions: {},
            resources: { cycle: cycleResource },
            requirements: []
        }),
        signal: testSignal()
    };
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected promise rejection.');
}

function assertLifecycleError(error: unknown): ResourceLifecycleError {
    if (!(error instanceof ResourceLifecycleError)) {
        throw new Error('Expected ResourceLifecycleError.');
    }

    return error;
}

async function assertRuntimeLifecycle(scope: TestScope): Promise<void> {
    const events = createEventLog();
    const server = runtimeLifecycleServer(events, runtimeLifecycleDatabase(events));
    const runtime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { server },
        requirements: [ { kind: 'serial' } ]
    });
    const session = await startRuntime({ runtime, signal: testSignal() });

    scope.assert.deepEqual(Object.keys(session.context), [ 'server' ]);
    scope.assert.deepEqual(session.context.server.results, [ 'ready' ]);
    scope.assert.deepEqual(events.values(), [ 'database signal', 'database acquire', 'server', 'server acquire' ]);
    await session.disposeOnce({ signal: testSignal() });
    await session.disposeOnce({ signal: testSignal() });
    scope.assert.deepEqual(events.values(), lifecycleEvents());
}

async function assertSharedDependencies(scope: TestScope): Promise<void> {
    const scenario = sharedDependencyScenario();
    const session = await startRuntime({ runtime: scenario.runtime, signal: testSignal() });

    scope.assert.equal(scenario.acquisitions(), 1);
    scope.assert.equal(session.context.store, scenario.database);
    scope.assert.deepEqual(scenario.events.values().toSorted(compareText), [ 'server', 'worker' ]);
    await session.disposeOnce({ signal: testSignal() });
    scope.assert.deepEqual(scenario.events.values().slice(2), [
        'worker dispose',
        'server dispose',
        'database dispose'
    ]);
}

async function assertConcurrentAcquisition(scope: TestScope): Promise<void> {
    const events = createEventLog();
    const gate = deferred<undefined>();
    const runtime = defineRuntime({
        name: 'concurrent',
        dimensions: {},
        resources: { slow: slowResource(events, gate), fast: fastResource(events) },
        requirements: []
    });
    const sessionPromise = startRuntime({ runtime, signal: testSignal() });

    await Promise.resolve();
    await Promise.resolve();
    scope.assert.deepEqual(events.values(), [ 'slow start', 'fast start' ]);
    gate.resolve(undefined);

    const session = await sessionPromise;

    scope.assert.deepEqual(session.context, { slow: 'slow', fast: 'fast' });
}

async function assertAcquireFailureCleanup(scope: TestScope): Promise<void> {
    const scenario = acquireFailureScenario();
    const error = assertLifecycleError(
        await rejectedValue(startRuntime({ runtime: scenario.runtime, signal: testSignal() }))
    );

    scope.assert.deepEqual(scenario.events.values(), [ 'database acquire', 'server acquire', 'database dispose' ]);
    scope.assert.deepEqual(error.failures().map(failureSummary), [
        [ 'acquire', 'server', scenario.acquireError ],
        [ 'dispose', 'database', scenario.disposeError ]
    ]);
}

async function assertDisposalFailure(scope: TestScope): Promise<void> {
    const scenario = disposalFailureScenario();
    const session = await startRuntime({ runtime: scenario.runtime, signal: testSignal() });
    const error = assertLifecycleError(await rejectedValue(session.disposeOnce({ signal: testSignal() })));
    const repeatedError = await rejectedValue(session.disposeOnce({ signal: testSignal() }));

    scope.assert.equal(repeatedError, error);
    scope.assert.deepEqual(scenario.events.values(), [ 'second dispose', 'first dispose' ]);
    scope.assert.deepEqual(error.failures().map(failureSummary), [
        [ 'dispose', 'second', scenario.secondDisposeError ],
        [ 'dispose', 'first', scenario.firstDisposeError ]
    ]);
}

async function assertGraphFailures(scope: TestScope): Promise<void> {
    const duplicateError = assertLifecycleError(await rejectedValue(startRuntime(duplicateRuntimeRequest())));
    const cycleError = assertLifecycleError(await rejectedValue(startRuntime(cycleRuntimeRequest())));

    scope.assert.deepEqual(duplicateError.failures().map(graphFailureSummary), [ [ 'graph', 'database' ] ]);
    scope.assert.deepEqual(cycleError.failures().map(graphFailureSummary), [ [ 'graph', 'cycle' ] ]);
}

function lifecycleTestCase(
    title: string,
    assertion: (scope: TestScope) => Promise<void>
): TestNode {
    return createTestCase({
        definitionLocations: [ { kind: 'unknown' } ],
        title,
        annotations: {},
        controls: {},
        async body(scope: TestScope) {
            await assertion(scope);

            return scope.assert.collect();
        }
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/resource-lifecycle.test.ts',
    annotations: {},
    controls: {},
    children: [
        lifecycleTestCase(
            'startRuntime acquires dependencies and disposes them once in reverse order',
            assertRuntimeLifecycle
        ),
        lifecycleTestCase('startRuntime shares dependency handles within one session', assertSharedDependencies),
        lifecycleTestCase('startRuntime acquires independent resources concurrently', assertConcurrentAcquisition),
        lifecycleTestCase('startRuntime cleans acquired resources after setup failure', assertAcquireFailureCleanup),
        lifecycleTestCase(
            'runtime session reports disposal failures and keeps disposeOnce idempotent',
            assertDisposalFailure
        ),
        lifecycleTestCase('startRuntime rejects invalid dependency graphs before acquisition', assertGraphFailures)
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
