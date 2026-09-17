import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    composeRuntimes,
    createResourcesModule,
    defineResource,
    defineRuntime,
    type ComposedRuntimeGraph
} from './resources.ts';

type Database = {
    readonly query: (sql: string) => readonly string[];
};

type Server = {
    readonly results: readonly string[];
};

function createDatabase(): Database {
    return {
        query(sql: string) {
            return [ sql ];
        }
    };
}

const databaseResource = defineResource({
    name: 'database',
    scope: 'per-case',
    requirements: [],
    acquire: createDatabase,
    dispose: null
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
    dispose: null
});
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
const { composeRuntimeContext } = createResourcesModule({
    async createTemporaryDirectory(pathPrefix) {
        return `${pathPrefix}created`;
    },
    async removeDirectory() {
        return undefined;
    },
    temporaryDirectoryPathPrefix: '/virtual/overkill-temporary-directory-'
});

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

function composedRuntimePair(): ComposedRuntimeGraph<readonly [typeof apiRuntime, typeof serverRuntime]> {
    return composeRuntimes(apiRuntime, serverRuntime);
}

function nestedRuntimePair(): ComposedRuntimeGraph<readonly [typeof apiRuntime | typeof serverRuntime]> {
    return composeRuntimes(composeRuntimes(apiRuntime, serverRuntime));
}

function assertRuntimeGraphComposition(scope: TestScope): void {
    const composed = composedRuntimePair();
    const database = createDatabase();
    const server = { results: [ 'ready' ] };
    const context = composeRuntimeContext({ base: 'scope' }, composed, {
        api: { database },
        server: { server }
    });

    assertBrandedDescriptor(scope, composed);
    scope.assert.equal(composed.kind, 'composed-runtimes');
    scope.assert.deepEqual(
        composed.runtimes.map(function runtimeName(runtime) {
            return runtime.name;
        }),
        [ 'api', 'server' ]
    );
    scope.assert.equal(Object.isFrozen(composed), true);
    scope.assert.equal(context.runtimes.api.database, database);
    scope.assert.equal(context.runtimes.server.server, server);
}

function assertNestedRuntimeGraphComposition(scope: TestScope): void {
    const composed = nestedRuntimePair();

    scope.assert.deepEqual(
        composed.runtimes.map(function runtimeName(runtime) {
            return runtime.name;
        }),
        [ 'api', 'server' ]
    );
}

function assertRuntimeGraphContextValidation(scope: TestScope): void {
    const composed = composedRuntimePair();

    scope.assert.throws(function composeIncompleteRuntimeContext() {
        Reflect.apply(composeRuntimeContext, undefined, [
            { base: 'scope' },
            composed,
            { api: { database: createDatabase() } }
        ]);
    }, { message: 'Runtime scope "server" is missing.' });
}

function assertRuntimeGraphCompositionRejectsInvalidInput(scope: TestScope): void {
    const duplicateApiRuntime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { database: databaseResource },
        requirements: []
    });
    const duplicateRuntime = defineRuntime({
        name: 'api',
        dimensions: {},
        resources: { server: serverResource },
        requirements: []
    });

    scope.assert.throws(function rejectEmptyComposition() {
        Reflect.apply(composeRuntimes, undefined, []);
    }, { message: 'composeRuntimes() requires at least one runtime graph.' });
    scope.assert.throws(function rejectDuplicateRuntimeNames() {
        Reflect.apply(composeRuntimes, undefined, [ duplicateApiRuntime, duplicateRuntime ]);
    }, { message: 'Runtime scope "api" is attached multiple times.' });
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/runtime-composition.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'composeRuntimes creates composed runtime graphs and scopes',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertRuntimeGraphComposition(scope);
                assertNestedRuntimeGraphComposition(scope);
                assertRuntimeGraphContextValidation(scope);
                assertRuntimeGraphCompositionRejectsInvalidInput(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
