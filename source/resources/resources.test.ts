import type { CompositeAssertionReturn } from '@overkill-dev/test/assert';
import { type CompositeCheckBuilder } from '@overkill-dev/test/assert';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, suite, test } from '@overkill-dev/test';

import { resourceAttachments } from '../attachments/attachment-context.ts';

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

const brandedDescriptorChecks = (
    check: CompositeCheckBuilder<'assert'>,
    descriptor: unknown
): CompositeAssertionReturn<'assert'> => {
    if (typeof descriptor !== 'object' || descriptor === null) {
        throw new Error('Expected object descriptor.');
    }
    const brandSymbols = Object.getOwnPropertySymbols(descriptor);
    const brandSymbol = brandSymbols[0];
    if (brandSymbol === undefined) {
        throw new Error('Expected descriptor brand.');
    }
    return check.group([
        check.equal(brandSymbols.length, 1),
        check.equal(Reflect.get(descriptor, brandSymbol), true)
    ]);
};
const assertBrandedDescriptor = defineCompositeAssertion({
    name: 'branded descriptor',
    assert: brandedDescriptorChecks
});

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

const assertRuntimeMatrixDescriptor = defineCompositeAssertion({
    name: 'runtime matrix descriptor',
    assert(check) {
        const matrix = defineRuntimeMatrix({
            name: 'node',
            variants: {
                'node-26': createRuntimeVariant('26'),
                'node-27': createRuntimeVariant('27')
            }
        });
        return check.group([
            brandedDescriptorChecks(check.annotated('branded descriptor'), matrix),
            check.equal(isDefinedRuntimeMatrix(matrix), true),
            check.equal(isDefinedRuntimeMatrix(createRuntimeVariant('28')), false),
            check.equal(matrix.name, 'node'),
            check.equal(matrix.variants['node-26'].id, 'node-26'),
            check.deepEqual(matrix.variants['node-27'].runtime.id, {
                dimensions: { node: '27' },
                name: 'node-27',
                scenarios: {},
                variantId: null
            })
        ]);
    }
});

const assertRuntimeMatrixSharedFactories = defineCompositeAssertion({
    name: 'runtime matrix shared factories',
    assert(check) {
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
        return check.group([
            check.deepEqual(matrix.variants['node-26'].runtime.dimensions, { node: '26' }),
            check.deepEqual(matrix.variants['node-27'].runtime.dimensions, { node: '27' })
        ]);
    }
});

const assertRuntimeMatrixShapeChecks = defineCompositeAssertion({
    name: 'runtime matrix shape checks',
    assert(check) {
        return check.group([
            check.throws(function rejectDifferentResourceKeys() {
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
            }, { message: 'Runtime matrix "node" variant "second" has different resource keys.' }),
            check.throws(function rejectDuplicateDimensions() {
                defineRuntimeMatrix({
                    name: 'node',
                    variants: {
                        first: createRuntimeVariant('26'),
                        second: createRuntimeVariant('26')
                    }
                });
            }, { message: 'Runtime matrix "node" variant "second" duplicates another dimension tuple.' }),
            check.throws(function rejectDifferentDimensionKeys() {
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
            }, { message: 'Runtime matrix "node" variant "second" has different dimension keys.' })
        ]);
    }
});

const assertRuntimeMatrixInputChecks = defineCompositeAssertion({
    name: 'runtime matrix input checks',
    assert(check) {
        return check.group([
            check.throws(function rejectInvalidMatrixName() {
                defineRuntimeMatrix({
                    name: 'node version',
                    variants: {
                        first: createRuntimeVariant('26')
                    }
                });
            }, { message: 'Runtime matrix "node version" must match ^[A-Za-z0-9._-]+$.' }),
            check.throws(function rejectInvalidVariantName() {
                defineRuntimeMatrix({
                    name: 'node',
                    variants: {
                        'node version': createRuntimeVariant('26')
                    }
                });
            }, { message: 'Runtime matrix variant "node version" must match ^[A-Za-z0-9._-]+$.' }),
            check.throws(function rejectEmptyVariants() {
                defineRuntimeMatrix({
                    name: 'node',
                    variants: {}
                });
            }, { message: 'Runtime matrix "node" requires at least one variant.' }),
            check.throws(function rejectInvalidFactoryResult() {
                Reflect.apply(defineRuntimeMatrix, undefined, [ {
                    name: 'node',
                    shared: {},
                    variants: {
                        first: function invalidRuntime() {
                            return { name: 'invalid' };
                        }
                    }
                } ]);
            }, { message: 'Runtime matrix variant "first" must resolve to a runtime descriptor.' })
        ]);
    }
});

const assertResourceDescriptorPredicates = defineCompositeAssertion({
    name: 'resource descriptor predicates',
    assert(check, runtime: unknown) {
        return check.group([
            check.equal(isDefinedResource(null), false),
            check.equal(isDefinedResource('database'), false),
            check.equal(isDefinedResource({ name: 'database' }), false),
            check.equal(isDefinedResource(databaseResource), true),
            check.equal(isDefinedResource(runtime), false)
        ]);
    }
});

const assertRuntimeDescriptorPredicates = defineCompositeAssertion({
    name: 'runtime descriptor predicates',
    assert(check, runtime: unknown) {
        return check.group([
            check.equal(isDefinedRuntime(null), false),
            check.equal(isDefinedRuntime('runtime'), false),
            check.equal(isDefinedRuntime({ name: 'api' }), false),
            check.equal(isDefinedRuntime(databaseResource), false),
            check.equal(isDefinedRuntime(runtime), true)
        ]);
    }
});

const assertRuntimeDescriptor = defineCompositeAssertion({
    name: 'runtime descriptor',
    assert(check) {
        const dimensions = { browser: 'chromium', node: '26' } as const;
        const resources = { database: databaseResource, server: serverResource } as const;
        const runtime = defineRuntime({
            name: 'node-browser',
            dimensions,
            resources,
            requirements: [ { kind: 'single-worker' } ]
        });
        return check.group([
            check.deepEqual(Object.keys(runtime.resources), [ 'database', 'server' ]),
            check.equal(runtime.resources, resources),
            check.equal(runtime.dimensions, dimensions),
            check.deepEqual(runtime.id, {
                name: 'node-browser',
                dimensions,
                scenarios: {},
                variantId: null
            }),
            check.deepEqual(runtime.requirements, [ { kind: 'single-worker' } ]),
            check.deepEqual([ Object.isFrozen(runtime), Object.isFrozen(runtime.id) ], [ true, true ]),
            brandedDescriptorChecks(check.annotated('branded descriptor'), runtime)
        ]);
    }
});

const assertRuntimeContextComposition = defineCompositeAssertion({
    name: 'runtime context composition',
    assert(check) {
        const runtime = defineRuntime({
            name: 'api',
            dimensions: {},
            resources: { database: databaseResource, server: serverResource },
            requirements: []
        });
        const database = createDatabase();
        const server = { results: [ 'ready' ] };
        const context = composeRuntimeContext({ base: 'scope' }, runtime, { database, server });
        return check.group([
            check.equal(context.base, 'scope'),
            check.equal(context.runtimes.api.database, database),
            check.equal(context.runtimes.api.server, server),
            check.equal(Object.isFrozen(context), true),
            check.equal(Object.isFrozen(context.runtimes), true)
        ]);
    }
});

const assertRuntimeContextCompositionMergesRuntimeScopes = defineCompositeAssertion({
    name: 'runtime context composition merges runtime scopes',
    assert(check) {
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
        return check.group([
            check.equal(secondContext.base, 'scope'),
            check.equal(secondContext.runtimes.api.database, database),
            check.equal(secondContext.runtimes.server.server, server)
        ]);
    }
});

const assertRuntimeContextCompositionRejectsDuplicateScopes = defineCompositeAssertion({
    name: 'runtime context composition rejects duplicate scopes',
    assert(check) {
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
        return check.group([ check.throws(function composeDuplicateRuntimeContext() {
            composeRuntimeContext(context as { readonly base: string; }, secondRuntime, { database: createDatabase() });
        }, { message: 'Runtime scope "api" already exists.' }) ]);
    }
});

const assertRuntimeContextCompositionRejectsInvalidRuntimeScopes = defineCompositeAssertion({
    name: 'runtime context composition rejects invalid runtime scopes',
    assert(check) {
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
        const [ firstCheck, ...remainingChecks ] = invalidContexts.map((context) => {
            return check.throws(function composeInvalidRuntimeContext() {
                Reflect.apply(composeRuntimeContext, undefined, [ context, runtime, { database: createDatabase() } ]);
            }, {
                message: 'composeRuntimeContext() requires context.runtimes to be an object when present.'
            });
        });
        if (firstCheck === undefined) {
            throw new Error('Expected at least one recorded check.');
        }
        return check.group([ firstCheck, ...remainingChecks ]);
    }
});

type TemporaryDirectoryResource = typeof temporaryDirectoryResource;

const assertTemporaryDirectoryDescriptor = defineMacro((title: string, resource: TemporaryDirectoryResource) =>
    test(title, (scope) => {
        scope.assert.deepEqual(resource.dependencies, {});
        scope.assert.equal(resource.name, 'scratch');
        scope.assert.equal(resource.scope, 'per-case');
        scope.assert.deepEqual(resource.requirements, []);
        scope.assert.equal(Object.isFrozen(resource), true);
        scope.assert(assertBrandedDescriptor, resource);

        return scope.assert.collect();
    })
);

const assertTemporaryDirectoryHandle = defineCompositeAssertion({
    name: 'temporary directory handle',
    assert(check, handle: TemporaryDirectoryHandle) {
        return check.group([
            check.equal(Object.isFrozen(handle), true),
            check.equal(handle.path.includes('overkill-temporary-directory-'), true)
        ]);
    }
});

const assertTemporaryDirectoryLifecycle = defineMacro((title: string, resource: TemporaryDirectoryResource) =>
    test(title, async (scope) => {
        if (resource.dispose === null) {
            throw new Error('Expected temporary directory disposal.');
        }

        const handle = await resource.acquire({
            workload: null,
            attachments: resourceAttachments('test'),
            dependencies: {},
            scenarios: {},
            signal: disposalSignal
        });

        scope.assert(assertTemporaryDirectoryHandle, handle);
        await resource.dispose(handle, {
            workload: null,
            attachments: resourceAttachments('test'),
            dependencies: {},
            scenarios: {},
            signal: disposalSignal
        });
        scope.assert.deepEqual(recordedTemporaryDirectoryDependencies.createdPathPrefixes, [
            '/virtual/overkill-temporary-directory-'
        ]);
        scope.assert.deepEqual(recordedTemporaryDirectoryDependencies.removedPaths, [
            '/virtual/overkill-temporary-directory-created'
        ]);

        return scope.assert.collect();
    })
);

const assertTemporaryDirectoryAcquireAbort = defineMacro((title: string, resource: TemporaryDirectoryResource) =>
    test(title, async (scope) => {
        const controller = new AbortController();

        controller.abort();
        await scope.assert.rejects(async function acquireAfterAbort() {
            await resource.acquire({
                workload: null,
                attachments: resourceAttachments('test'),
                dependencies: {},
                scenarios: {},
                signal: controller.signal
            });
        }, {
            name: 'AbortError'
        });

        return scope.assert.collect();
    })
);

export const testNode = suite('Resources', [
    suite('defineResource returns an inert frozen descriptor', [
        test('database resource descriptor', (scope) => {
            scope.assert.deepEqual(databaseResource.dependencies, {});
            scope.assert.equal(databaseResource.name, 'database');
            scope.assert.equal(databaseResource.scope, 'per-case');
            scope.assert.deepEqual(databaseResource.requirements, [
                { kind: 'exclusive-resource', name: 'database' },
                { kind: 'startup-budget-milliseconds', minimumMilliseconds: 500 }
            ]);
            scope.assert.equal(Object.isFrozen(databaseResource), true);
            scope.assert(assertBrandedDescriptor, databaseResource);

            return scope.assert.collect();
        }),
        test('descriptor predicates', (scope) => {
            const runtime = defineRuntime({
                name: 'api',
                dimensions: {},
                resources: { database: databaseResource },
                requirements: []
            });

            scope.assert(assertResourceDescriptorPredicates, runtime);
            scope.assert(assertRuntimeDescriptorPredicates, runtime);

            return scope.assert.collect();
        }),
        test('database resource callbacks', async (scope) => {
            const context = {
                workload: null,
                attachments: resourceAttachments('test'),
                dependencies: {},
                scenarios: {},
                signal: disposalSignal
            };
            const database = await databaseResource.acquire(context);

            scope.assert.deepEqual(database.query('select 1'), [ 'select 1' ]);
            if (databaseResource.dispose === null) {
                throw new Error('Expected resource disposal.');
            }

            await databaseResource.dispose(database, context);

            return scope.assert.collect();
        }),
        test('server resource callbacks', async (scope) => {
            const database = createDatabase();
            const context = {
                workload: null,
                attachments: resourceAttachments('test'),
                dependencies: { database },
                scenarios: {},
                signal: disposalSignal
            };
            const server = await serverResource.acquire(context);

            scope.assert.deepEqual(server.results, [ 'server started' ]);
            if (serverResource.dispose === null) {
                throw new Error('Expected resource disposal.');
            }

            await serverResource.dispose(server, context);

            return scope.assert.collect();
        })
    ]),
    test('defineRuntime preserves resource keys and freezes runtime identity', function (scope) {
        scope.assert(assertRuntimeDescriptor);
        scope.assert(assertRuntimeContextComposition);
        scope.assert(assertRuntimeContextCompositionMergesRuntimeScopes);
        scope.assert(assertRuntimeContextCompositionRejectsDuplicateScopes);
        scope.assert(assertRuntimeContextCompositionRejectsInvalidRuntimeScopes);

        return scope.assert.collect();
    }),
    test('defineRuntimeMatrix preserves variants and validates shapes', function (scope) {
        scope.assert(assertRuntimeMatrixDescriptor);
        scope.assert(assertRuntimeMatrixSharedFactories);
        scope.assert(assertRuntimeMatrixShapeChecks);
        scope.assert(assertRuntimeMatrixInputChecks);

        return scope.assert.collect();
    }),
    suite('createTemporaryDirectoryResource uses host operations', [
        assertTemporaryDirectoryDescriptor('temporary directory descriptor', temporaryDirectoryResource),
        assertTemporaryDirectoryLifecycle('temporary directory lifecycle', temporaryDirectoryResource),
        assertTemporaryDirectoryAcquireAbort('temporary directory acquire abort', temporaryDirectoryResource)
    ])
]);
