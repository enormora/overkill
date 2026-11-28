import type { IsEqual } from 'type-fest';
import { suite, test } from '@overkill-dev/test';
import { acceptsCall, rejectsCall, sameType } from '@overkill-dev/type-test';
import { defineSimulatedHttpServer } from '../simulation/simulation.entry-point.ts';
import { isEqualTo, type IsAssignable } from '../../test-support/type-relations.ts';
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

type LocalResourceScope = Exclude<ResourceScope, 'per-run'>;
type ExpectedLocalResourceDefinitionInput = {
    [Scope in LocalResourceScope]: {
        readonly acquire: (context: ResourceCreationContext) => Database | Promise<Database>;
        readonly dependencies?: Readonly<Record<PropertyKey, never>>;
        readonly deserializeHandle?: never;
        readonly dispose: ((handle: Database, context: ResourceDisposalContext) => Promise<void> | void) | null;
        readonly name: 'database';
        readonly requirements: readonly ExecutionRequirement[];
        readonly scope: Scope;
        readonly serializeHandle?: never;
    };
}[LocalResourceScope];
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

declare const assertPerCaseResourceGraphUnderTest: typeof assertPerCaseResourceGraph;

export const testNode = suite('Resource descriptors, scenarios, and attachments', [
    suite('Resource descriptors and runtime context inference', [
        suite('infers resource handles and runtime context from descriptors', [
            test('infers handles from descriptors', function (scope) {
                scope.assert(sameType<IsEqual<ResourceHandle<typeof database>, Database>, true>());
                scope.assert(sameType<IsEqual<ResourceHandle<typeof server>, Server>, true>());
                scope.assert(
                    sameType<
                        IsEqual<ResourceContext<typeof server.dependencies>, ExpectedDatabaseResourceContext>,
                        true
                    >()
                );
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<typeof database>()(server.dependencies.database)
                );
                scope.assert(
                    sameType.withActual<true>(),
                    isEqualTo<Readonly<Record<PropertyKey, never>>>()(database.dependencies)
                );
                return scope.assert.collect();
            }),
            test('infers runtime and resource contexts', function (scope) {
                scope.assert(sameType<IsEqual<RuntimeContext<typeof runtime>, ExpectedRuntimeContext>, true>());
                scope.assert(sameType<IsEqual<RuntimeContext<typeof runtime>['database'], Database>, true>());
                scope.assert(sameType<IsEqual<RuntimeContext<typeof runtime>['server'], Server>, true>());
                scope.assert(
                    sameType<IsEqual<RuntimeScopeContext<typeof runtime>, ExpectedRuntimeScopeContext>, true>()
                );
                scope.assert(sameType.withActual<'api'>(), runtime.name);
                return scope.assert.collect();
            })
        ]),
        test('infers projected resource handles', function (scope) {
            scope.assert(sameType<IsEqual<ResourceHandle<typeof projectedDatabase>, ProjectedDatabase>, true>());
            scope.assert(sameType.withActual<'projected-database'>(), projectedDatabase.name);
            return scope.assert.collect();
        }),
        test('infers aliased and hidden dependency runtime contexts', function (scope) {
            scope.assert(sameType<
                IsEqual<RuntimeContext<typeof aliasedRuntime>, {
                    readonly server: Server;
                    readonly store: Database;
                }>,
                true
            >());
            scope.assert(sameType.withActual<'aliased-api'>(), aliasedRuntime.name);
            scope.assert(sameType<
                IsEqual<RuntimeContext<typeof hiddenDependencyRuntime>, {
                    readonly server: Server;
                }>,
                true
            >());
            scope.assert(sameType.withActual<'hidden-dependency-api'>(), hiddenDependencyRuntime.name);
            return scope.assert.collect();
        }),
        test('exposes runtime lifecycle session types', function (scope) {
            const runtimeSession = startRuntime({ runtime, signal: typeTestController.signal });
            const resourceSession = startResources({ resources: { database }, signal: typeTestController.signal });

            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<RuntimeSession<typeof runtime>>>()(runtimeSession)
            );
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<Promise<ResourceSession<{ readonly database: typeof database; }>>>()(resourceSession)
            );
            scope.assert(acceptsCall, function () {
                assertPerCaseResourceGraphUnderTest({ database });
            });
            scope.assert(sameType<
                IsEqual<ResourceLifecycleFailure, {
                    readonly cause: unknown;
                    readonly phase: 'acquire' | 'dispose' | 'graph';
                    readonly resourceName: string;
                }>,
                true
            >());
            scope.assert(sameType<IsAssignable<ResourceLifecycleError, Error>, true>());
            return scope.assert.collect();
        }),
        test('infers built-in temporary directory resources', function (scope) {
            scope.assert(
                sameType<IsEqual<ResourceHandle<typeof temporaryDirectory>, TemporaryDirectoryHandle>, true>()
            );
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
        test('infers local-service and simulated HTTP resource handles', function (scope) {
            scope.assert(
                sameType<
                    IsEqual<ResourceHandle<typeof localService>, { readonly url: `http://${string}:${number}`; }>,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<ResourceHandle<typeof localHttpService>, LocalHttpResourceHandle<LocalHttpServiceHandle>>,
                    true
                >()
            );
            scope.assert(
                sameType<IsEqual<ResourceHandle<typeof localProcessService>, { readonly output: string; }>, true>()
            );
            scope.assert(sameType.withActual<'local-service'>(), localService.name);
            scope.assert(sameType.withActual<'http-service'>(), localHttpService.name);
            scope.assert(sameType.withActual<'process-service'>(), localProcessService.name);
            scope.assert(
                sameType<
                    IsEqual<
                        ResourceHandle<typeof simulatedApiResource>,
                        SimulatedHttpServerResourceHandle<typeof simulatedApi>
                    >,
                    true
                >()
            );
            scope.assert(
                sameType<
                    IsEqual<
                        ResourceHandle<typeof simulatedApiResource>['scenarioUrl'],
                        (scenario: 'default' | 'outage', path: string) => string
                    >,
                    true
                >()
            );
            scope.assert(sameType.withActual<'simulated-api'>(), simulatedApiResource.name);
            return scope.assert.collect();
        }),
        test('exposes required descriptor field contracts', function (scope) {
            scope.assert(
                sameType<ResourceScope, 'per-case' | 'per-file' | 'per-run' | 'per-suite' | 'shared-per-worker'>()
            );
            scope.assert(sameType<IsEqual<RuntimeDimensions, Readonly<Record<string, string>>>, true>());
            scope.assert(sameType<
                IsEqual<RuntimeId<'api', { readonly node: '26'; }>, {
                    readonly name: 'api';
                    readonly dimensions: { readonly node: '26'; };
                    readonly scenarios: Readonly<Record<string, string>>;
                    readonly variantId: string | null;
                }>,
                true
            >());
            scope.assert(sameType.withActual<'node'>(), runtimeMatrix.name);
            scope.assert(sameType.withActual<'node-26'>(), runtimeMatrix.variants['node-26'].id);
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<typeof runtime>()(runtimeMatrix.variants['node-26'].runtime)
            );
            scope.assert(
                sameType<
                    IsAssignable<ExpectedLocalResourceDefinitionInput, ResourceDefinitionInput<'database', Database>>,
                    true
                >()
            );
            scope.assert(sameType<
                IsAssignable<
                    ExpectedProjectedResourceDefinitionInput,
                    ResourceDefinitionInput<
                        'database',
                        Database,
                        Readonly<Record<PropertyKey, never>>,
                        string,
                        ProjectedDatabase
                    >
                >,
                true
            >());
            return scope.assert.collect();
        })
    ]),
    suite('runtime scenarios', [
        test('types partial bindings from resource slots', function (scope) {
            scope.assert(acceptsCall, function () {
                return scenarioRuntime.scenario({});
            });
            scope.assert(acceptsCall, function () {
                return scenarioRuntime.scenario({ database: 'empty' });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return scenarioRuntime.scenario({ database: 'missing' });
            });
            scope.assert(rejectsCall('argument-type'), function () {
                return scenarioRuntime.scenario({ unknown: 'empty' });
            });
            scope.assert(
                sameType.withActual<true>(),
                isEqualTo<readonly ['default' | 'outage', ...('default' | 'outage')[]]>()(
                    simulatedApiResource.scenarios['simulated-api'].values
                )
            );
            return scope.assert.collect();
        })
    ]),
    suite('resource attachment contexts', [
        test('provides attachments across resource lifecycle contexts', function (scope) {
            scope.assert(sameType<IsEqual<ResourceCreationContext['attachments'], RuntimeAttachments>, true>());
            scope.assert(sameType<IsEqual<ResourceDisposalContext['attachments'], RuntimeAttachments>, true>());
            scope.assert(sameType<IsEqual<ResourceProjectionContext['attachments'], RuntimeAttachments>, true>());
            return scope.assert.collect();
        })
    ])
]);
