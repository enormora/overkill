import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test-type-authoring';
import { acceptsCall, assignableFrom, assignableTo, rejectsCall, sameType } from '@overkill-dev/type-test';
import { defineSimulatedHttpServer } from '../simulation/simulation.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    type assertPerCaseResourceGraph,
    createLocalHttpServiceResource,
    createLocalProcessServiceResource,
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
    type RuntimeAttachments,
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
    type LocalHttpResourceHandle,
    type LocalHttpServiceHandle,
    type SimulatedHttpServerResourceHandle,
    type TemporaryDirectoryHandle,
    type TranscriptView
} from './resources.entry-point.ts';

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
        const queryResult = await context.dependencies.database.query('url');

        return { url: String(queryResult[0]) };
    },
    dispose() {
        return undefined;
    }
});
const scenarioDatabase = defineResource({
    name: 'scenario-database',
    scope: 'per-case',
    requirements: [],
    scenarios: {
        database: {
            default: 'populated',
            timing: 'acquire',
            values: [ 'populated', 'empty' ]
        }
    },
    acquire(context) {
        return context.scenarios.database;
    },
    dispose() {
        return undefined;
    }
});
const scenarioRuntime = defineRuntime({
    name: 'scenario-api',
    dimensions: {},
    resources: { database: scenarioDatabase },
    requirements: []
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
const simulatedApiResource = createSimulatedHttpServerResource({
    simulation: simulatedApi,
    address: { kind: 'loopback', port: 0 }
});
const localService = defineLocalServiceResource({
    name: 'local-service',
    scope: 'per-case',
    requirements: [],
    dependencies: {},
    address: { kind: 'loopback', port: 0 },
    start(context) {
        return Object.freeze({ host: context.address.host, port: context.address.port });
    },
    ready(owner) {
        return Object.freeze({ url: `http://${owner.host}:${owner.port}` });
    },
    dispose() {
        return undefined;
    }
});
const localHttpService = createLocalHttpServiceResource({
    name: 'http-service',
    scope: 'per-case',
    requirements: [],
    dependencies: {},
    address: { kind: 'loopback', port: 0 },
    createServer() {
        throw new Error('type only');
    },
    handle(handle) {
        return handle;
    },
    dispose() {
        return undefined;
    }
});
const localProcessService = createLocalProcessServiceResource({
    name: 'process-service',
    scope: 'per-case',
    requirements: [],
    dependencies: {},
    address: { kind: 'loopback', port: 0 },
    outputBufferBytes: 1024,
    shutdown: {
        gracefulSignal: 'SIGTERM',
        forceSignal: 'SIGKILL',
        graceMilliseconds: 100
    },
    command() {
        return {
            command: 'node',
            arguments: [],
            environment: {},
            workingDirectory: null
        };
    },
    ready(owner) {
        return Object.freeze({
            output: owner.output.stdout.text()
        });
    }
});

const databaseHandle = {
    async query(sql: string) {
        return [ sql ];
    }
};
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

declare const assertPerCaseResourceGraphUnderTest: typeof assertPerCaseResourceGraph;
declare const defineResourceUnderTest: typeof defineResource;
declare const defineRuntimeUnderTest: typeof defineRuntime;

export const testNode = suite('resources', [
    suite('@overkill-dev/resources', [
        suite('infers resource handles and runtime context from descriptors', [
            test('infers handles from descriptors', function (typeScope) {
                typeScope.assert(sameType<ResourceHandle<typeof database>, Database>());
                typeScope.assert(sameType<ResourceHandle<typeof server>, Server>());
                typeScope.assert(
                    sameType<ResourceContext<typeof server.dependencies>, ExpectedDatabaseResourceContext>()
                );
                typeScope.assert(sameType.withActual<typeof database>(), server.dependencies.database);
                typeScope.assert(sameType.withActual<Readonly<Record<PropertyKey, never>>>(), database.dependencies);
                return typeScope.assert.collect();
            }),
            test('infers runtime and resource contexts', function (typeScope) {
                typeScope.assert(sameType<IsEqual<RuntimeContext<typeof runtime>, ExpectedRuntimeContext>, true>());
                typeScope.assert(sameType<RuntimeContext<typeof runtime>['database'], Database>());
                typeScope.assert(sameType<RuntimeContext<typeof runtime>['server'], Server>());
                typeScope.assert(
                    sameType<IsEqual<RuntimeScopeContext<typeof runtime>, ExpectedRuntimeScopeContext>, true>()
                );
                typeScope.assert(sameType.withActual<'api'>(), runtime.name);
                return typeScope.assert.collect();
            })
        ]),
        test('infers projected resource handles', function (typeScope) {
            typeScope.assert(sameType<ResourceHandle<typeof projectedDatabase>, ProjectedDatabase>());
            typeScope.assert(sameType.withActual<'projected-database'>(), projectedDatabase.name);
            return typeScope.assert.collect();
        }),
        test('infers aliased and hidden dependency runtime contexts', function (typeScope) {
            typeScope.assert(sameType<
                IsEqual<RuntimeContext<typeof aliasedRuntime>, {
                    readonly server: Server;
                    readonly store: Database;
                }>,
                true
            >());
            typeScope.assert(sameType.withActual<'aliased-api'>(), aliasedRuntime.name);
            typeScope.assert(sameType<
                IsEqual<RuntimeContext<typeof hiddenDependencyRuntime>, {
                    readonly server: Server;
                }>,
                true
            >());
            typeScope.assert(sameType.withActual<'hidden-dependency-api'>(), hiddenDependencyRuntime.name);
            return typeScope.assert.collect();
        }),
        test('exposes runtime lifecycle session types', function (typeScope) {
            const runtimeSession = startRuntime({ runtime, signal: typeTestController.signal });
            const resourceSession = startResources({ resources: { database }, signal: typeTestController.signal });

            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<RuntimeSession<typeof runtime>>>()(runtimeSession)
            );
            typeScope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<ResourceSession<{ readonly database: typeof database; }>>>()(resourceSession)
            );
            typeScope.assert(acceptsCall, () => assertPerCaseResourceGraphUnderTest({ database }));
            typeScope.assert(sameType<ResourceLifecycleFailure, {
                readonly cause: unknown;
                readonly phase: 'acquire' | 'dispose' | 'graph';
                readonly resourceName: string;
            }>());
            typeScope.assert(assignableTo<ResourceLifecycleError, Error>());
            return typeScope.assert.collect();
        }),
        test('infers built-in temporary directory resources', function (typeScope) {
            typeScope.assert(sameType<ResourceHandle<typeof temporaryDirectory>, TemporaryDirectoryHandle>());
            typeScope.assert(sameType.withActual<'scratch'>(), temporaryDirectory.name);
            typeScope.assert(sameType<TemporaryDirectoryHandle, {
                readonly path: string;
                readonly transcript: TranscriptView<never>;
            }>());
            return typeScope.assert.collect();
        }),
        test('infers local-service and simulated HTTP resource handles', function (typeScope) {
            typeScope.assert(
                sameType<ResourceHandle<typeof localService>, { readonly url: `http://${string}:${number}`; }>()
            );
            typeScope.assert(
                sameType<ResourceHandle<typeof localHttpService>, LocalHttpResourceHandle<LocalHttpServiceHandle>>()
            );
            typeScope.assert(sameType<ResourceHandle<typeof localProcessService>, { readonly output: string; }>());
            typeScope.assert(sameType.withActual<'local-service'>(), localService.name);
            typeScope.assert(sameType.withActual<'http-service'>(), localHttpService.name);
            typeScope.assert(sameType.withActual<'process-service'>(), localProcessService.name);
            typeScope.assert(
                sameType<
                    IsEqual<
                        ResourceHandle<typeof simulatedApiResource>,
                        SimulatedHttpServerResourceHandle<typeof simulatedApi>
                    >,
                    true
                >()
            );
            typeScope.assert(
                sameType<
                    ResourceHandle<typeof simulatedApiResource>['scenarioUrl'],
                    (scenario: 'default' | 'outage', path: string) => string
                >()
            );
            typeScope.assert(sameType.withActual<'simulated-api'>(), simulatedApiResource.name);
            return typeScope.assert.collect();
        }),
        test('exposes required descriptor field contracts', function (typeScope) {
            typeScope.assert(
                sameType<ResourceScope, 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker'>()
            );
            typeScope.assert(sameType<RuntimeDimensions, Readonly<Record<string, string>>>());
            typeScope.assert(sameType<RuntimeId<'api', { readonly node: '26'; }>, {
                readonly name: 'api';
                readonly dimensions: { readonly node: '26'; };
                readonly scenarios: Readonly<Record<string, string>>;
                readonly variantId: string | null;
            }>());
            typeScope.assert(sameType.withActual<'node'>(), runtimeMatrix.name);
            typeScope.assert(sameType.withActual<'node-26'>(), runtimeMatrix.variants['node-26'].id);
            typeScope.assert(sameType.withActual<typeof runtime>(), runtimeMatrix.variants['node-26'].runtime);
            typeScope.assert(
                assignableFrom<ResourceDefinitionInput<'database', Database>, ExpectedLocalResourceDefinitionInput>()
            );
            typeScope.assert(assignableFrom<
                ResourceDefinitionInput<
                    'database',
                    Database,
                    Readonly<Record<PropertyKey, never>>,
                    string,
                    ProjectedDatabase
                >,
                ExpectedProjectedResourceDefinitionInput
            >());
            return typeScope.assert.collect();
        }),
        test('keeps invalid shapes out of typed descriptors', function (typeScope) {
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineResourceUnderTest({
                    name: 'database',
                    scope: 'case',
                    requirements: [],
                    acquire: createInvalidDatabase,
                    dispose: null
                }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineResourceUnderTest({
                    name: 'database',
                    scope: 'per-case',
                    requirements: [ { kind: 'startup-budget-milliseconds', milliseconds: 1000 } ],
                    acquire: createInvalidDatabase,
                    dispose: null
                }));
            typeScope.assert(rejectsCall('argument-type'), () =>
                defineRuntimeUnderTest({
                    name: 'api',
                    dimensions: { node: 26 },
                    resources: { database },
                    requirements: []
                }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineResourceUnderTest({
                    name: 'projected-database',
                    scope: 'per-run',
                    requirements: [],
                    acquire: createInvalidDatabase,
                    dispose: null
                }));
            typeScope.assert(rejectsCall('no-matching-overload'), () =>
                defineResourceUnderTest({
                    name: 'server',
                    scope: 'per-case',
                    requirements: [],
                    dependencies: { database: createInvalidDatabase() },
                    acquire: createInvalidDatabase,
                    dispose: null
                }));
            return typeScope.assert.collect();
        })
    ]),
    suite('runtime scenarios', [
        test('types partial bindings from resource slots', function (typeScope) {
            typeScope.assert(acceptsCall, () => scenarioRuntime.scenario({}));
            typeScope.assert(acceptsCall, () => scenarioRuntime.scenario({ database: 'empty' }));
            typeScope.assert(rejectsCall('argument-type'), () => scenarioRuntime.scenario({ database: 'missing' }));
            typeScope.assert(rejectsCall('argument-type'), () => scenarioRuntime.scenario({ unknown: 'empty' }));
            typeScope.assert(
                sameType.withActual<readonly ['default' | 'outage', ...('default' | 'outage')[]]>(),
                simulatedApiResource.scenarios['simulated-api'].values
            );
            return typeScope.assert.collect();
        })
    ]),
    suite('resource attachment contexts', [
        test('provides attachments across resource lifecycle contexts', function (typeScope) {
            typeScope.assert(sameType<ResourceCreationContext['attachments'], RuntimeAttachments>());
            typeScope.assert(sameType<ResourceDisposalContext['attachments'], RuntimeAttachments>());
            typeScope.assert(sameType<ResourceProjectionContext['attachments'], RuntimeAttachments>());
            return typeScope.assert.collect();
        })
    ])
]);
