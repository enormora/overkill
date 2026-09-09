import { describe, expect, test } from 'tstyche';
import {
    composeRuntimeContext,
    defineResource,
    defineRuntime,
    type ExecutionRequirement,
    type ResourceContext,
    type ResourceCreationContext,
    type ResourceDefinitionInput,
    type ResourceDisposalContext,
    type ResourceHandle,
    type ResourceScope,
    type RuntimeContext,
    type RuntimeDimensions,
    type RuntimeId
} from './resources.entry-point.ts';

type ExpectedResourceDefinitionInput = {
    readonly acquire: (context: ResourceCreationContext) => Database | Promise<Database>;
    readonly dependencies?: Readonly<Record<PropertyKey, never>>;
    readonly dispose: ((handle: Database, context: ResourceDisposalContext) => Promise<void> | void) | null;
    readonly name: 'database';
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: ResourceScope;
};

type ExpectedRuntimeContext = {
    readonly database: Database;
    readonly server: Server;
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
        expect(context.resources.database).type.toBe<Database>();
        expect(context.resources.database.query).type.toBe<(sql: string) => Promise<readonly string[]>>();
        const queryResult = await context.resources.database.query('url');

        return { url: String(queryResult[0]) };
    },
    dispose(_server, context) {
        expect(context.resources.database).type.toBe<Database>();
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

const databaseHandle = {
    async query(sql: string) {
        return [ sql ];
    }
};
const serverHandle = { url: 'http://localhost' };

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
        expect<RuntimeContext<typeof runtime>>().type.toBe<ExpectedRuntimeContext>();
        expect<RuntimeContext<typeof runtime>['database']>().type.toBe<Database>();
        expect<RuntimeContext<typeof runtime>['server']>().type.toBe<Server>();
        expect<RuntimeContext<typeof aliasedRuntime>>().type.toBe<{
            readonly server: Server;
            readonly store: Database;
        }>();
        expect(aliasedRuntime.name).type.toBe<'aliased-api'>();
        expect(runtime.name).type.toBe<'api'>();
    });

    test('composes runtime handles into a typed context', function () {
        const context = composeRuntimeContext({ test: true }, runtime, {
            database: databaseHandle,
            server: serverHandle
        });

        expect(context.runtime).type.toBe<ExpectedRuntimeContext>();
        expect(context.test).type.toBe<boolean>();
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith({ test: true }, runtime, {
            database: databaseHandle
        });
        expect<typeof composeRuntimeContext>().type.not.toBeCallableWith({ test: true }, runtime, {
            database: databaseHandle,
            server: { port: 80 }
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
        }>();
        expect<ResourceDefinitionInput<'database', Database>>().type.toBe<ExpectedResourceDefinitionInput>();
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
        expect<typeof defineRuntime>().type.not.toBeCallableWith({
            name: 'api',
            dimensions: {},
            resources: { server },
            requirements: []
        });
    });
});
