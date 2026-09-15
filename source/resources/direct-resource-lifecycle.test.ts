import { createSuite, createTestCase, type TestNode, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defineResource,
    type EmptyResourceDependencies,
    type ResourceScope,
    type ResourceDefinition
} from './resources.ts';
import {
    runtimeAsyncDisposeSymbol,
    startResources,
    type ResourceSessionDisposalContext
} from './resource-session.ts';
import { assertPerCaseResourceGraph } from './resource-graph.ts';
import { ResourceLifecycleError } from './resource-lifecycle-error.ts';

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
type ServiceContextSession = {
    readonly context: {
        readonly service: Server;
    };
};
type DisposableSession = {
    readonly disposeOnce: (context: ResourceSessionDisposalContext) => Promise<void>;
};
type DatabaseResource = ResourceDefinition<'database', Database, EmptyResourceDependencies>;
type ServerDependencies = { readonly database: DatabaseResource; };
type DisposableResource = ResourceDefinition<'disposable', string, EmptyResourceDependencies>;
type FailingResource = ResourceDefinition<'failing', string, EmptyResourceDependencies>;
type ScopedResource = ResourceDefinition<'scoped', string, EmptyResourceDependencies>;

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

function testSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function createDatabase(): Database {
    return {
        query(sql: string) {
            return [ sql ];
        }
    };
}

function databaseResource(events: EventLog, recordAcquisition: () => void): DatabaseResource {
    return defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(context): Database {
            recordAcquisition();
            events.add(context.signal.aborted ? 'database aborted signal' : 'database signal', 'database acquire');

            return createDatabase();
        },
        dispose() {
            events.add('database dispose');
        }
    });
}

function serverResource(
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
            events.add(context.dependencies.database.query(name)[0] ?? 'missing', `${name} acquire`);

            return { results: [ name ] };
        },
        dispose() {
            events.add(`${name} dispose`);
        }
    });
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected promise rejection.');
}

async function rejectedCallback(callback: () => void): Promise<unknown> {
    try {
        callback();
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected callback rejection.');
}

function assertLifecycleError(error: unknown): ResourceLifecycleError {
    if (!(error instanceof ResourceLifecycleError)) {
        throw new Error('Expected ResourceLifecycleError.');
    }

    return error;
}

function disposableResource(events: EventLog, disposeError: Error): DisposableResource {
    return defineResource({
        name: 'disposable',
        scope: 'per-case',
        requirements: [],
        acquire() {
            events.add('disposable acquire');

            return 'disposable';
        },
        dispose() {
            events.add('disposable dispose');
            throw disposeError;
        }
    });
}

function failingResource(acquireError: Error): FailingResource {
    return defineResource({
        name: 'failing',
        scope: 'per-case',
        requirements: [],
        acquire(): string {
            throw acquireError;
        },
        dispose: null
    });
}

function scopedResource(scope: ResourceScope): ScopedResource {
    return defineResource({
        name: 'scoped',
        scope,
        requirements: [],
        acquire() {
            return 'scoped';
        },
        dispose: null
    });
}

function assertSessionContext(
    scope: TestScope,
    session: ServiceContextSession,
    events: EventLog,
    acquisitions: number
): void {
    scope.assert.equal(acquisitions, 1);
    scope.assert.deepEqual(Object.keys(session.context), [ 'service' ]);
    scope.assert.deepEqual(session.context.service.results, [ 'server' ]);
    scope.assert.deepEqual(events.values(), [
        'database signal',
        'database acquire',
        'server',
        'server acquire'
    ]);
}

async function assertSessionDisposal(
    scope: TestScope,
    session: DisposableSession,
    events: EventLog
): Promise<void> {
    await session.disposeOnce({ signal: testSignal() });
    await session.disposeOnce({ signal: testSignal() });
    scope.assert.deepEqual(events.values().slice(4), [ 'server dispose', 'database dispose' ]);
}

async function assertDirectResourceLifecycle(scope: TestScope): Promise<void> {
    let acquisitions = 0;
    const events = createEventLog();
    const database = databaseResource(events, function recordAcquisition() {
        acquisitions += 1;
    });
    const server = serverResource(events, database, 'server');
    const session = await startResources({ resources: { service: server }, signal: testSignal() });

    assertSessionContext(scope, session, events, acquisitions);
    await assertSessionDisposal(scope, session, events);
}

async function assertSharedDependencyHandles(scope: TestScope): Promise<void> {
    let acquisitions = 0;
    const events = createEventLog();
    const database = databaseResource(events, function recordAcquisition() {
        acquisitions += 1;
    });
    const session = await startResources({
        resources: {
            server: serverResource(events, database, 'server'),
            store: database,
            worker: serverResource(events, database, 'worker')
        },
        signal: testSignal()
    });

    scope.assert.equal(acquisitions, 1);
    scope.assert.deepEqual(session.context.store.query('store'), [ 'store' ]);
    await session.disposeOnce({ signal: testSignal() });
    scope.assert.deepEqual(events.values().slice(6), [
        'worker dispose',
        'server dispose',
        'database dispose'
    ]);
}

async function assertStartupFailureCleanup(scope: TestScope): Promise<void> {
    const events = createEventLog();
    const acquireError = new Error('setup failed');
    const disposeError = new Error('cleanup failed');
    const error = assertLifecycleError(
        await rejectedValue(startResources({
            resources: {
                disposable: disposableResource(events, disposeError),
                failing: failingResource(acquireError)
            },
            signal: testSignal()
        }))
    );

    scope.assert.deepEqual(events.values(), [ 'disposable acquire', 'disposable dispose' ]);
    scope.assert.deepEqual(
        error.failures().map(function failureSummary(failure) {
            return [ failure.phase, failure.resourceName, failure.cause ];
        }),
        [
            [ 'acquire', 'failing', acquireError ],
            [ 'dispose', 'disposable', disposeError ]
        ]
    );
}

async function assertAsyncDisposal(scope: TestScope): Promise<void> {
    const events = createEventLog();
    const database = databaseResource(events, function recordAcquisition(): void {
        return undefined;
    });
    const session = await startResources({ resources: { database }, signal: testSignal() });

    const dispose: unknown = Reflect.get(session, runtimeAsyncDisposeSymbol());

    scope.require.function(dispose);
    await dispose();
    scope.assert.deepEqual(events.values(), [
        'database signal',
        'database acquire',
        'database dispose'
    ]);
}

async function assertNullDispose(scope: TestScope): Promise<void> {
    const resource = scopedResource('per-case');
    const session = await startResources({ resources: { resource }, signal: testSignal() });

    await session.disposeOnce({ signal: testSignal() });
    scope.assert.equal(session.context.resource, 'scoped');
}

async function assertScopeValidation(scope: TestScope): Promise<void> {
    const perCaseResource = scopedResource('per-case');
    const broaderResource = scopedResource('per-run');
    const error = assertLifecycleError(
        await rejectedCallback(function validateBroaderScope() {
            assertPerCaseResourceGraph({ broaderResource });
        })
    );

    assertPerCaseResourceGraph({ perCaseResource });
    scope.assert.equal(error.failures()[0]?.resourceName, 'scoped');
}

function lifecycleTestCase(title: string, assertion: (scope: TestScope) => Promise<void>): TestNode {
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
    title: 'source/resources/direct-resource-lifecycle.test.ts',
    annotations: {},
    controls: {},
    children: [
        lifecycleTestCase(
            'startResources exposes direct handles and disposes them once in reverse order',
            assertDirectResourceLifecycle
        ),
        lifecycleTestCase('startResources shares dependency handles within one session', assertSharedDependencyHandles),
        lifecycleTestCase('startResources cleans acquired resources after setup failure', assertStartupFailureCleanup),
        lifecycleTestCase('resource session supports async disposal', assertAsyncDisposal),
        lifecycleTestCase('startResources skips null dispose callbacks', assertNullDispose),
        lifecycleTestCase('direct resource scope validation accepts only per-case resources', assertScopeValidation)
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
