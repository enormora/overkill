import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    createResourcesModule,
    isDefinedResource,
    isDefinedRuntime,
    isDefinedRuntimeMatrix,
    type RuntimeDefinition,
    type TemporaryDirectoryHandle,
    type ResourcesModuleDependencies
} from './resources.ts';

type Database = {
    readonly query: (sql: string) => readonly string[];
};

type Server = {
    readonly results: readonly string[];
};

type RecordedTemporaryDirectoryDependencies = ResourcesModuleDependencies & {
    readonly createdPathPrefixes: readonly string[];
    readonly removedPaths: readonly string[];
};

const disposalController = new AbortController();
const disposalSignal = disposalController.signal;

function createDatabase(): Database {
    return {
        query(sql: string) {
            return [ sql ];
        }
    };
}

function assertBrandedDescriptor(scope: TestScope, descriptor: unknown): void {
    if (typeof descriptor !== 'object' || descriptor === null) {
        throw new Error('Expected object descriptor.');
    }

    const brandSymbols = Object.getOwnPropertySymbols(descriptor);
    const brandSymbol = brandSymbols[0];

    if (brandSymbol === undefined) {
        throw new Error('Expected descriptor brand.');
    }

    scope.assert.equal(brandSymbols.length, 1);
    scope.assert.equal(Reflect.get(descriptor, brandSymbol), true);
}

function createRecordedTemporaryDirectoryDependencies(): RecordedTemporaryDirectoryDependencies {
    const createdPathPrefixes: string[] = [];
    const removedPaths: string[] = [];

    return {
        createdPathPrefixes,
        removedPaths,
        temporaryDirectoryPathPrefix: '/virtual/overkill-temporary-directory-',
        createTemporaryDirectory(pathPrefix) {
            createdPathPrefixes.push(pathPrefix);

            return `${pathPrefix}created`;
        },
        removeDirectory(path) {
            removedPaths.push(path);
        }
    };
}

const recordedTemporaryDirectoryDependencies = createRecordedTemporaryDirectoryDependencies();
const resourcesModule = createResourcesModule(recordedTemporaryDirectoryDependencies);
const {
    composeRuntimeContext,
    createTemporaryDirectoryResource,
    defineResource,
    defineRuntime,
    defineRuntimeMatrix
} = resourcesModule;

const databaseResource = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [
        { kind: 'exclusive-resource', name: 'database' },
        { kind: 'startup-budget-milliseconds', minimumMilliseconds: 500 }
    ],
    acquire: createDatabase,
    dispose(database) {
        database.query('disposed');
    }
});

const serverResource = defineResource({
    name: 'server',
    scope: 'per-case',
    requirements: [],
    dependencies: { database: databaseResource },
    acquire(context): Server {
        return {
            results: context.dependencies.database.query('server started')
        };
    },
    dispose(server, context) {
        context.dependencies.database.query(server.results.join(','));
    }
});
const temporaryDirectoryResource = createTemporaryDirectoryResource('scratch');

function createRuntimeVariant(node: string): RuntimeDefinition {
    return defineRuntime({
        name: `node-${node}`,
        dimensions: { node },
        resources: { database: databaseResource, server: serverResource },
        requirements: []
    });
}

function assertRuntimeMatrixDescriptor(scope: TestScope): void {
    const matrix = defineRuntimeMatrix({
        name: 'node',
        variants: {
            'node-26': createRuntimeVariant('26'),
            'node-27': createRuntimeVariant('27')
        }
    });

    assertBrandedDescriptor(scope, matrix);
    scope.assert.equal(isDefinedRuntimeMatrix(matrix), true);
    scope.assert.equal(isDefinedRuntimeMatrix(createRuntimeVariant('28')), false);
    scope.assert.equal(matrix.name, 'node');
    scope.assert.equal(matrix.variants['node-26'].id, 'node-26');
    scope.assert.deepEqual(matrix.variants['node-27'].runtime.id, {
        dimensions: { node: '27' },
        name: 'node-27',
        variantId: null
    });
}

function assertRuntimeMatrixSharedFactories(scope: TestScope): void {
    const matrix = defineRuntimeMatrix({
        name: 'node',
        shared: { prefix: 'node' },
        variants: {
            'node-26': function node26(shared) {
                return createRuntimeVariant(`${shared.prefix}-26`.slice(5));
            },
            'node-27': createRuntimeVariant('27')
        }
    });

    scope.assert.deepEqual(matrix.variants['node-26'].runtime.dimensions, { node: '26' });
    scope.assert.deepEqual(matrix.variants['node-27'].runtime.dimensions, { node: '27' });
}

function assertRuntimeMatrixShapeChecks(scope: TestScope): void {
    scope.assert.throws(function rejectDifferentResourceKeys() {
        defineRuntimeMatrix({
            name: 'node',
            variants: {
                first: createRuntimeVariant('26'),
                second: defineRuntime({
                    name: 'missing-server',
                    dimensions: { node: '27' },
                    resources: { database: databaseResource },
                    requirements: []
                })
            }
        });
    }, { message: 'Runtime matrix "node" variant "second" has different resource keys.' });

    scope.assert.throws(function rejectDuplicateDimensions() {
        defineRuntimeMatrix({
            name: 'node',
            variants: {
                first: createRuntimeVariant('26'),
                second: createRuntimeVariant('26')
            }
        });
    }, { message: 'Runtime matrix "node" variant "second" duplicates another dimension tuple.' });

    scope.assert.throws(function rejectDifferentDimensionKeys() {
        defineRuntimeMatrix({
            name: 'node',
            variants: {
                first: createRuntimeVariant('26'),
                second: defineRuntime({
                    name: 'browser',
                    dimensions: { browser: 'chromium' },
                    resources: { database: databaseResource, server: serverResource },
                    requirements: []
                })
            }
        });
    }, { message: 'Runtime matrix "node" variant "second" has different dimension keys.' });
}

function assertRuntimeMatrixInputChecks(scope: TestScope): void {
    scope.assert.throws(function rejectInvalidMatrixName() {
        defineRuntimeMatrix({
            name: 'node version',
            variants: {
                first: createRuntimeVariant('26')
            }
        });
    }, { message: 'Runtime matrix "node version" must match ^[A-Za-z0-9._-]+$.' });

    scope.assert.throws(function rejectInvalidVariantName() {
        defineRuntimeMatrix({
            name: 'node',
            variants: {
                'node version': createRuntimeVariant('26')
            }
        });
    }, { message: 'Runtime matrix variant "node version" must match ^[A-Za-z0-9._-]+$.' });

    scope.assert.throws(function rejectEmptyVariants() {
        defineRuntimeMatrix({
            name: 'node',
            variants: {}
        });
    }, { message: 'Runtime matrix "node" requires at least one variant.' });

    scope.assert.throws(function rejectInvalidFactoryResult() {
        Reflect.apply(defineRuntimeMatrix, undefined, [ {
            name: 'node',
            shared: {},
            variants: {
                first: function invalidRuntime() {
                    return { name: 'invalid' };
                }
            }
        } ]);
    }, { message: 'Runtime matrix variant "first" must resolve to a runtime descriptor.' });
}

function assertResourceDescriptorPredicates(scope: TestScope, runtime: unknown): void {
    scope.assert.equal(isDefinedResource(null), false);
    scope.assert.equal(isDefinedResource('database'), false);
    scope.assert.equal(isDefinedResource({ name: 'database' }), false);
    scope.assert.equal(isDefinedResource(databaseResource), true);
    scope.assert.equal(isDefinedResource(runtime), false);
}

function assertRuntimeDescriptorPredicates(scope: TestScope, runtime: unknown): void {
    scope.assert.equal(isDefinedRuntime(null), false);
    scope.assert.equal(isDefinedRuntime('runtime'), false);
    scope.assert.equal(isDefinedRuntime({ name: 'api' }), false);
    scope.assert.equal(isDefinedRuntime(databaseResource), false);
    scope.assert.equal(isDefinedRuntime(runtime), true);
}

function assertDescriptorPredicates(scope: TestScope): void {
    const runtime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource },
        requirements: []
    });

    assertResourceDescriptorPredicates(scope, runtime);
    assertRuntimeDescriptorPredicates(scope, runtime);
}

function assertDatabaseResourceDescriptor(scope: TestScope): void {
    scope.assert.deepEqual(databaseResource.dependencies, {});
    scope.assert.equal(databaseResource.name, 'database');
    scope.assert.equal(databaseResource.scope, 'per-case');
    scope.assert.deepEqual(databaseResource.requirements, [
        { kind: 'exclusive-resource', name: 'database' },
        { kind: 'startup-budget-milliseconds', minimumMilliseconds: 500 }
    ]);
    scope.assert.equal(Object.isFrozen(databaseResource), true);
    assertBrandedDescriptor(scope, databaseResource);
}

async function assertDatabaseResourceCallbacks(scope: TestScope): Promise<void> {
    const database = await databaseResource.acquire({ dependencies: {}, signal: disposalSignal });

    scope.assert.deepEqual(database.query('select 1'), [ 'select 1' ]);
    if (databaseResource.dispose === null) {
        throw new Error('Expected resource disposal.');
    }

    await databaseResource.dispose(database, { dependencies: {}, signal: disposalSignal });
}

async function assertServerResourceCallbacks(scope: TestScope): Promise<void> {
    const database = createDatabase();
    const server = await serverResource.acquire({
        dependencies: { database },
        signal: disposalSignal
    });

    scope.assert.deepEqual(server.results, [ 'server started' ]);
    if (serverResource.dispose === null) {
        throw new Error('Expected resource disposal.');
    }

    await serverResource.dispose(server, {
        dependencies: { database },
        signal: disposalSignal
    });
}

function assertRuntimeDescriptor(scope: TestScope): void {
    const dimensions = { browser: 'chromium', node: '26' } as const;
    const resources = { database: databaseResource, server: serverResource } as const;
    const runtime = defineRuntime({
        name: 'node-browser',
        dimensions,
        resources,
        requirements: [ { kind: 'single-worker' } ]
    });

    scope.assert.deepEqual(Object.keys(runtime.resources), [ 'database', 'server' ]);
    scope.assert.equal(runtime.resources, resources);
    scope.assert.equal(runtime.dimensions, dimensions);
    scope.assert.deepEqual(runtime.id, {
        name: 'node-browser',
        dimensions,
        variantId: null
    });
    scope.assert.deepEqual(runtime.requirements, [ { kind: 'single-worker' } ]);
    scope.assert.deepEqual([ Object.isFrozen(runtime), Object.isFrozen(runtime.id) ], [ true, true ]);
    assertBrandedDescriptor(scope, runtime);
}

function assertRuntimeContextComposition(scope: TestScope): void {
    const runtime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource, server: serverResource },
        requirements: []
    });
    const database = createDatabase();
    const server = { results: [ 'ready' ] };
    const context = composeRuntimeContext({ base: 'scope' }, runtime, { database, server });

    scope.assert.equal(context.base, 'scope');
    scope.assert.equal(context.runtimes.api.database, database);
    scope.assert.equal(context.runtimes.api.server, server);
    scope.assert.equal(Object.isFrozen(context), true);
    scope.assert.equal(Object.isFrozen(context.runtimes), true);
}

function assertRuntimeContextCompositionMergesRuntimeScopes(scope: TestScope): void {
    const apiRuntime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource },
        requirements: []
    });
    const serverRuntime = defineRuntime({
        name: 'server',
        dimensions: {},
        resources: { server: serverResource },
        requirements: []
    });
    const database = createDatabase();
    const firstContext = composeRuntimeContext({ base: 'scope' }, apiRuntime, { database });
    const server = { results: [ 'ready' ] };
    const secondContext = composeRuntimeContext(firstContext, serverRuntime, { server });

    scope.assert.equal(secondContext.base, 'scope');
    scope.assert.equal(secondContext.runtimes.api.database, database);
    scope.assert.equal(secondContext.runtimes.server.server, server);
}

function assertRuntimeContextCompositionRejectsDuplicateScopes(scope: TestScope): void {
    const firstRuntime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource },
        requirements: []
    });
    const secondRuntime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource },
        requirements: []
    });
    const context = composeRuntimeContext({ base: 'scope' }, firstRuntime, { database: createDatabase() });

    scope.assert.throws(function composeDuplicateRuntimeContext() {
        composeRuntimeContext(context as { readonly base: string; }, secondRuntime, { database: createDatabase() });
    }, { message: 'Runtime scope "api" already exists.' });
}

function assertRuntimeContextCompositionRejectsInvalidRuntimeScopes(scope: TestScope): void {
    const runtime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource },
        requirements: []
    });
    const invalidContexts = [
        { runtimes: 'api' },
        { runtimes: null },
        { runtimes: [] }
    ];

    for (const context of invalidContexts) {
        scope.assert.throws(function composeInvalidRuntimeContext() {
            Reflect.apply(composeRuntimeContext, undefined, [ context, runtime, { database: createDatabase() } ]);
        }, {
            message: 'composeRuntimeContext() requires context.runtimes to be an object when present.'
        });
    }
}

type TemporaryDirectoryResource = typeof temporaryDirectoryResource;

function assertTemporaryDirectoryDescriptor(scope: TestScope, resource: TemporaryDirectoryResource): void {
    scope.assert.deepEqual(resource.dependencies, {});
    scope.assert.equal(resource.name, 'scratch');
    scope.assert.equal(resource.scope, 'per-case');
    scope.assert.deepEqual(resource.requirements, []);
    scope.assert.equal(Object.isFrozen(resource), true);
    assertBrandedDescriptor(scope, resource);
}

function assertTemporaryDirectoryHandle(scope: TestScope, handle: TemporaryDirectoryHandle): void {
    scope.assert.equal(Object.isFrozen(handle), true);
    scope.assert.equal(handle.path.includes('overkill-temporary-directory-'), true);
}

async function assertTemporaryDirectoryLifecycle(
    scope: TestScope,
    resource: TemporaryDirectoryResource
): Promise<void> {
    if (resource.dispose === null) {
        throw new Error('Expected temporary directory disposal.');
    }

    const handle = await resource.acquire({ dependencies: {}, signal: disposalSignal });

    assertTemporaryDirectoryHandle(scope, handle);
    await resource.dispose(handle, { dependencies: {}, signal: disposalSignal });
    scope.assert.deepEqual(recordedTemporaryDirectoryDependencies.createdPathPrefixes, [
        '/virtual/overkill-temporary-directory-'
    ]);
    scope.assert.deepEqual(recordedTemporaryDirectoryDependencies.removedPaths, [
        '/virtual/overkill-temporary-directory-created'
    ]);
}

async function assertTemporaryDirectoryAcquireAbort(
    scope: TestScope,
    resource: TemporaryDirectoryResource
): Promise<void> {
    const controller = new AbortController();

    controller.abort();
    await scope.assert.rejects(async function acquireAfterAbort() {
        await resource.acquire({ dependencies: {}, signal: controller.signal });
    }, {
        name: 'AbortError'
    });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/resources.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'defineResource returns an inert frozen descriptor',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                assertDatabaseResourceDescriptor(scope);
                assertDescriptorPredicates(scope);
                await assertDatabaseResourceCallbacks(scope);
                await assertServerResourceCallbacks(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'defineRuntime preserves resource keys and freezes runtime identity',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertRuntimeDescriptor(scope);
                assertRuntimeContextComposition(scope);
                assertRuntimeContextCompositionMergesRuntimeScopes(scope);
                assertRuntimeContextCompositionRejectsDuplicateScopes(scope);
                assertRuntimeContextCompositionRejectsInvalidRuntimeScopes(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'defineRuntimeMatrix preserves variants and validates shapes',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertRuntimeMatrixDescriptor(scope);
                assertRuntimeMatrixSharedFactories(scope);
                assertRuntimeMatrixShapeChecks(scope);
                assertRuntimeMatrixInputChecks(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'createTemporaryDirectoryResource uses host operations',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                assertTemporaryDirectoryDescriptor(scope, temporaryDirectoryResource);
                await assertTemporaryDirectoryLifecycle(scope, temporaryDirectoryResource);
                await assertTemporaryDirectoryAcquireAbort(scope, temporaryDirectoryResource);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
