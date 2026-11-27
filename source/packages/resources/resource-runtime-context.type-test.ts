import type { IsEqual } from 'type-fest';
import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { rejectsCall, sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import { isEqualTo } from '../../test-support/type-relations.ts';
import {
    composeRuntimeContext,
    composeRuntimes,
    defineResource,
    defineRuntime
} from './resources.entry-point.ts';

type ExpectedRuntimeContext = {
    readonly database: Database;
    readonly server: Server;
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
        const queryResult = await context.dependencies.database.query('url');

        return { url: String(queryResult[0]) };
    },
    dispose() {
        return undefined;
    }
});

const runtime = defineRuntime({
    name: 'api',
    dimensions: { node: '26' },
    resources: { database, server },
    requirements: [ { kind: 'serial' } ]
});
const secondaryRuntime = defineRuntime({
    name: 'secondary-api',
    dimensions: {},
    resources: { database },
    requirements: []
});
const composedRuntime = composeRuntimes(runtime, secondaryRuntime);

const databaseHandle = {
    async query(sql: string) {
        return [ sql ];
    }
};
const serverHandle = { url: 'http://localhost' };

declare const composeRuntimeContextUnderTest: typeof composeRuntimeContext;

export const testNode = suite('resource runtime composition', [
    test('composes runtime handles into a typed context', function (typeScope) {
        const context = composeRuntimeContext({ test: true }, runtime, {
            database: databaseHandle,
            server: serverHandle
        });
        const nestedContext = composeRuntimeContext(context, secondaryRuntime, {
            database: databaseHandle
        });

        typeScope.assert(sameType<IsEqual<typeof context.runtimes.api, ExpectedRuntimeContext>, true>());
        typeScope.assert(sameType.withActual<boolean>(), context.test);
        typeScope.assert(sameType<IsEqual<typeof nestedContext.runtimes.api, ExpectedRuntimeContext>, true>());
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<{ readonly database: Database; }>()(nestedContext.runtimes['secondary-api'])
        );
        typeScope.assert(
            rejectsCall('argument-type'),
            () =>
                composeRuntimeContextUnderTest({ test: true }, runtime, {
                    database: databaseHandle
                })
        );
        typeScope.assert(
            rejectsCall('argument-type'),
            () =>
                composeRuntimeContextUnderTest({ test: true }, runtime, {
                    database: databaseHandle,
                    server: { port: 80 }
                })
        );
        typeScope.assert(rejectsCall('argument-type'), () =>
            composeRuntimeContextUnderTest(context, runtime, {
                database: databaseHandle,
                server: serverHandle
            }));
        return typeScope.assert.collect();
    }),
    test('composes runtime graphs into typed scopes', function (typeScope) {
        const context = composeRuntimeContext({ test: true }, composedRuntime, {
            api: {
                database: databaseHandle,
                server: serverHandle
            },
            'secondary-api': {
                database: databaseHandle
            }
        });

        typeScope.assert(sameType.withActual<'composed-runtimes'>(), composedRuntime.kind);
        typeScope.assert(sameType<IsEqual<typeof context.runtimes.api, ExpectedRuntimeContext>, true>());
        typeScope.assert(
            sameType.withActual<true>(),
            isEqualTo<{ readonly database: Database; }>()(context.runtimes['secondary-api'])
        );
        typeScope.assert(rejectsCall('argument-type'), () =>
            composeRuntimeContextUnderTest(
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
            ));
        typeScope.assert(
            rejectsCall('argument-type'),
            () =>
                composeRuntimeContextUnderTest({ test: true }, composedRuntime, {
                    api: { database: databaseHandle }
                })
        );
        return typeScope.assert.collect();
    })
]);
