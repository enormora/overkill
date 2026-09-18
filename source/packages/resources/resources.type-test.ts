import { describe, expect, test } from 'tstyche';
import {
    type assertPerCaseResourceGraph,
    composeRuntimeContext,
    composeRuntimes,
    createSimulatedHttpServerResource,
    createTemporaryDirectoryResource,
    defineLocalServiceResource,
    defineResource,
    defineRuntime,
    defineRuntimeMatrix,
    type ResourceLifecycleError,
    startResources,
    startRuntime,
    type ExecutionRequirement,
    type ResourceContext,
    type ResourceCreationContext,
    type ResourceDefinitionInput,
    type ResourceDisposalContext,
    type ResourceHandle,
    type ResourceLifecycleFailure,
    type ResourceSession,
    type ResourceProjectionContext,
    type ResourceScope,
    type RuntimeContext,
    type RuntimeDimensions,
    type RuntimeId,
    type RuntimeScopeContext,
    type RuntimeSession,
    type TemporaryDirectoryHandle
} from './resources.entry-point.ts';
import { defineSimulatedHttpServer } from '../simulation/simulation.entry-point.ts';
import type { SimulatedHttpServerHandle } from '../simulation/http.entry-point.ts';

type ExpectedLocalResourceDefinitionInput = {
    readonly acquire: (context: ResourceCreationContext) => Database | Promise<Database>;
    readonly dependencies?: Readonly<Record<PropertyKey, never>>;
    readonly deserializeHandle?: never;
    readonly dispose: ((handle: Database, context: ResourceDisposalContext) => Promise<void> | void) | null;
    readonly name: 'database';
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Exclude<ResourceScope, 'per-run'>;
    readonly serializeHandle?: never;
};
type ExpectedProjectedResourceDefinitionInput = {
    readonly acquire: (context: ResourceCreationContext) => Database | Promise<Database>;
    readonly dependencies?: Readonly<Record<PropertyKey, never>>;
    readonly deserializeHandle: (payload: string, context: ResourceProjectionContext) => ProjectedDatabase;
    readonly dispose: ((handle: Database, context: ResourceDisposalContext) => Promise<void> | void) | null;
    readonly name: 'database';
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: 'per-file' | 'per-run' | 'per-suite';
    readonly serializeHandle: (handle: Database, context: ResourceProjectionContext) => string;
};

type ExpectedRuntimeContext = {
    readonly database: Database;
    readonly server: Server;
};

type ExpectedRuntimeScopeContext = {
    readonly api: ExpectedRuntimeContext;
};

type ExpectedDatabaseResourceContext = {
    readonly database: Database;
};

type Database = {
    readonly query: (sql: string) => Promise<readonly string[]>;
};

type Server = {
    readonly url: string;
};
type ProjectedDatabase = {
    readonly connectionString: string;
};

const database = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [
        { kind: 'exclusive-resource', name: 'database' },
        { kind: 'startup-budget-milliseconds', minimumMilliseconds: 1000 }
    ],
    acquire(): Database {
        return {
            async query() {
                return [];
            }
        };
    },
    dispose() {
        return undefined;
    }
});

const server = defineResource({
    name: 'server',
    scope: 'shared-per-worker',
    requirements: [ { kind: 'single-worker' } ],
    dependencies: { database },
    async acquire(context): Promise<Server> {
        expect(context.dependencies.database).type.toBe<Database>();
        expect(context.dependencies.database.query).type.toBe<(sql: string) => Promise<readonly string[]>>();
        const queryResult = await context.dependencies.database.query('url');

        return { url: String(queryResult[0]) };
    },
    dispose(_server, context) {
        expect(context.dependencies.database).type.toBe<Database>();
    }
});

const runtime = defineRuntime({
    name: 'api',
    dimensions: { node: '26' },
    resources: { database, server },
    requirements: [ { kind: 'serial' } ]
});
const aliasedRuntime = defineRuntime({
    name: 'aliased-api',
    dimensions: {},
    resources: { store: database, server },
    requirements: []
});
const temporaryDirectory = createTemporaryDirectoryResource('scratch');
const hiddenDependencyRuntime = defineRuntime({
    name: 'hidden-dependency-api',
    dimensions: {},
    resources: { server },
    requirements: []
});
const secondaryRuntime = defineRuntime({
    name: 'secondary-api',
    dimensions: {},
    resources: { database },
    requirements: []
});
const runtimeMatrix = defineRuntimeMatrix({
    name: 'node',
    variants: {
        'node-26': runtime,
        'node-27': defineRuntime({
            name: 'api-node-27',
            dimensions: { node: '27' },
            resources: { database, server },
            requirements: []
        })
    }
});
const composedRuntime = composeRuntimes(runtime, secondaryRuntime);
const typeTestController = new AbortController();
const simulatedApi = defineSimulatedHttpServer({
    name: 'simulated-api',
    scenarios: {
        default: { status: 200, title: 'standard responses' },
        outage: { status: 503, title: 'upstream outage' }
    },
    handle(_request, scenario) {
        return Response.json({ status: scenario.descriptor.status });
    }
});
const simulatedApiResource = createSimulatedHttpServerResource({ simulation: simulatedApi });
const localService = defineLocalServiceResource({
    name: 'local-service',
    scope: 'per-case',
    requirements: [],
    start(context) {
        return { url: `http://${context.address.host}:${context.address.port}` };
    },
    dispose() {
        return undefined;
    }
});

const databaseHandle = {
    async query(sql: string) {
        return [ sql ];
    }
};
const serverHandle = { url: 'http://localhost' };
const projectedDatabase = defineResource({
    name: 'projected-database',
    scope: 'per-run',
    requirements: [
        { kind: 'capacity-weight', weight: 3 },
        { kind: 'affinity-key', key: 'database:primary' },
        { kind: 'fault-domain', key: 'zone-a' }
    ],
    acquire(): Database {
        return databaseHandle;
    },
    deserializeHandle(payload): ProjectedDatabase {
        return { connectionString: payload };
    },
    dispose: null,
    serializeHandle(): string {
        return 'postgres://localhost';
    }
});

function createInvalidDatabase(): Database {
    return {
        async query(sql: string) {
            return [ sql ];
        }
    };
}

describe('@overkill-dev/resources', function () {
    test('infers resource handles and runtime context from descriptors', function () {
        expect<ResourceHandle<typeof database>>().type.toBe<Database>();
        expect<ResourceHandle<typeof server>>().type.toBe<Server>();
        expect<ResourceContext<typeof server.dependencies>>().type.toBe<ExpectedDatabaseResourceContext>();
        expect(server.dependencies.database).type.toBe<typeof database>();
        expect(database.dependencies).type.toBe<Readonly<Record<PropertyKey, never>>>();
        expect<RuntimeContext<typeof runtime>>().type.toBe<ExpectedRuntimeContext>();
        expect<RuntimeContext<typeof runtime>['database']>().type.toBe<Database>();
        expect<RuntimeContext<typeof runtime>['server']>().type.toBe<Server>();
        expect<RuntimeScopeContext<typeof runtime>>().type.toBe<ExpectedRuntimeScopeContext>();
        expect(runtime.name).type.toBe<'api'>();
    });

    test('infers projected resource handles', function () {
        expect<ResourceHandle<typeof projectedDatabase>>().type.toBe<ProjectedDatabase>();
        expect(projectedDatabase.name).type.toBe<'projected-database'>();
    });

    test('infers aliased and hidden dependency runtime contexts', function () {
        expect<RuntimeContext<typeof aliasedRuntime>>().type.toBe<{
            readonly server: Server;
            readonly store: Database;
        }>();
        expect(aliasedRuntime.name).type.toBe<'aliased-api'>();
        expect<RuntimeContext<typeof hiddenDependencyRuntime>>().type.toBe<{
            readonly server: Server;
        }>();
        expect(hiddenDependencyRuntime.name).type.toBe<'hidden-dependency-api'>();
    });

    test('exposes runtime lifecycle session types', function () {
        const runtimeSession = startRuntime({ runtime, signal: typeTestController.signal });
        const resourceSession = startResources({ resources: { database }, signal: typeTestController.signal });

        expect(runtimeSession).type.toBe<Promise<RuntimeSession<typeof runtime>>>();
        expect(resourceSession).type.toBe<Promise<ResourceSession<{ readonly database: typeof database; }>>>();
        expect<typeof assertPerCaseResourceGraph>().type.toBeCallableWith({ database });
        expect<ResourceLifecycleFailure>().type.toBe<{
            readonly cause: unknown;
            readonly phase: 'acquire' | 'dispose' | 'graph';
            readonly resourceName: string;
        }>();
        expect<ResourceLifecycleError>().type.toBeAssignableTo<Error>();
    });

    test('infers built-in temporary directory resources', function () {
        expect<ResourceHandle<typeof temporaryDirectory>>().type.toBe<TemporaryDirectoryHandle>();
        expect(temporaryDirectory.name).type.toBe<'scratch'>();
        expect<TemporaryDirectoryHandle>().type.toBe<{ readonly path: string; }>();
    });

    test('infers local-service and simulated HTTP resource handles', function () {
        expect<ResourceHandle<typeof localService>>().type.toBe<{ url: string; }>();
        expect<ResourceHandle<typeof simulatedApiResource>>().type.toBe<SimulatedHttpServerHandle<typeof simulatedApi>>();
        expect<ResourceHandle<typeof simulatedApiResource>['scenarioUrl']>().type.toBe<
            (scenario: 'default' | 'outage', path: string) => string
        >();
        expect(simulatedApiResource.name).type.toBe<'simulated-api'>();
    });

    test('composes runtime handles into a typed context', function () {
        const context = composeRuntimeContext({ test: true }, runtime, {
            database: databaseHandle,
            server: serverHandle
        });
        const nestedContext = composeRuntimeContext(context, secondaryRuntime, {
            database: databaseHandle
        });

        expect(context.runtimes.api).type.toBe<ExpectedRuntimeContext>();
        expect(context.test).type.toBe<boolean>();
        expect(nestedContext.runtimes.api).type.toBe<ExpectedRuntimeContext>();
        expect(nestedContext.runtimes['secondary-api']).type.toBe<{ readonly database: Database; }>();
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith({ test: true }, runtime, {
            database: databaseHandle
        });
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith({ test: true }, runtime, {
            database: databaseHandle,
            server: { port: 80 }
        });
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith(context, runtime, {
            database: databaseHandle,
            server: serverHandle
        });
    });

    test('composes runtime graphs into typed scopes', function () {
        const context = composeRuntimeContext({ test: true }, composedRuntime, {
            api: {
                database: databaseHandle,
                server: serverHandle
            },
            'secondary-api': {
                database: databaseHandle
            }
        });

        expect(composedRuntime.kind).type.toBe<'composed-runtimes'>();
        expect(context.runtimes.api).type.toBe<ExpectedRuntimeContext>();
        expect(context.runtimes['secondary-api']).type.toBe<{ readonly database: Database; }>();
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith(
            {
                runtimes: {
                    api: {
                        database: databaseHandle,
                        server: serverHandle
                    }
                }
            },
            composedRuntime,
            {
                api: {
                    database: databaseHandle,
                    server: serverHandle
                },
                'secondary-api': {
                    database: databaseHandle
                }
            }
        );
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith({ test: true }, composedRuntime, {
            api: { database: databaseHandle }
        });
    });

    test('exposes required descriptor field contracts', function () {
        expect<ResourceScope>().type.toBe<
            'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker'
        >();
        expect<RuntimeDimensions>().type.toBe<Readonly<Record<string, string>>>();
        expect<RuntimeId<'api', { readonly node: '26'; }>>().type.toBe<{
            readonly name: 'api';
            readonly dimensions: { readonly node: '26'; };
            readonly variantId: string | null;
        }>();
        expect(runtimeMatrix.name).type.toBe<'node'>();
        expect(runtimeMatrix.variants['node-26'].id).type.toBe<'node-26'>();
        expect(runtimeMatrix.variants['node-26'].runtime).type.toBe<typeof runtime>();
        expect<ResourceDefinitionInput<'database', Database>>().type.toBeAssignableFrom<
            ExpectedLocalResourceDefinitionInput
        >();
        expect<
            ResourceDefinitionInput<
                'database',
                Database,
                Readonly<Record<PropertyKey, never>>,
                string,
                ProjectedDatabase
            >
        >()
            .type
            .toBeAssignableFrom<ExpectedProjectedResourceDefinitionInput>();
    });

    test('keeps invalid shapes out of typed descriptors', function () {
        expect<typeof defineResource>().type.not.toBeCallableWith({
            name: 'database',
            scope: 'case',
            requirements: [],
            acquire: createInvalidDatabase,
            dispose: null
        });
        expect<typeof defineResource>().type.not.toBeCallableWith({
            name: 'database',
            scope: 'per-case',
            requirements: [ { kind: 'startup-budget-milliseconds', milliseconds: 1000 } ],
            acquire: createInvalidDatabase,
            dispose: null
        });
        expect<typeof defineRuntime>().type.not.toBeCallableWith({
            name: 'api',
            dimensions: { node: 26 },
            resources: { database },
            requirements: []
        });
        expect<typeof defineResource>().type.not.toBeCallableWith({
            name: 'projected-database',
            scope: 'per-run',
            requirements: [],
            acquire: createInvalidDatabase,
            dispose: null
        });
        expect<typeof defineResource>().type.not.toBeCallableWith({
            name: 'server',
            scope: 'per-case',
            requirements: [],
            dependencies: { database: createInvalidDatabase() },
            acquire: createInvalidDatabase,
            dispose: null
        });
    });
});
