import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    createResourcesModule,
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
    defineRuntime
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
            results: context.resources.database.query('server started')
        };
    },
    dispose(server, context) {
        context.resources.database.query(server.results.join(','));
    }
});
const temporaryDirectoryResource = createTemporaryDirectoryResource('scratch');

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
    const database = await databaseResource.acquire({ resources: {}, signal: disposalSignal });

    scope.assert.deepEqual(database.query('select 1'), [ 'select 1' ]);
    if (databaseResource.dispose === null) {
        throw new Error('Expected resource disposal.');
    }

    await databaseResource.dispose(database, { resources: {}, signal: disposalSignal });
}

async function assertServerResourceCallbacks(scope: TestScope): Promise<void> {
    const database = createDatabase();
    const server = await serverResource.acquire({
        resources: { database },
        signal: disposalSignal
    });

    scope.assert.deepEqual(server.results, [ 'server started' ]);
    if (serverResource.dispose === null) {
        throw new Error('Expected resource disposal.');
    }

    await serverResource.dispose(server, {
        resources: { database },
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
        dimensions
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
    scope.assert.equal(context.runtime.database, database);
    scope.assert.equal(context.runtime.server, server);
    scope.assert.equal(Object.isFrozen(context), true);
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

    const handle = await resource.acquire({ resources: {}, signal: disposalSignal });

    assertTemporaryDirectoryHandle(scope, handle);
    await resource.dispose(handle, { resources: {}, signal: disposalSignal });
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
        await resource.acquire({ resources: {}, signal: controller.signal });
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
