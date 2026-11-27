import { suite, test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { sameType } from '../../../tools/type-tests/relations.entry-point.ts';
import {
    defineResource
} from './resources.entry-point.ts';

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

export const testNode = suite('resource callbacks', [
    test('infers database dependencies in resource callbacks', function (typeScope) {
        defineResource({
            name: 'server',
            scope: 'shared-per-worker',
            requirements: [ { kind: 'single-worker' } ],
            dependencies: { database },
            async acquire(context): Promise<Server> {
                typeScope.assert(sameType.withActual<Database>(), context.dependencies.database);
                typeScope.assert(
                    sameType.withActual<(sql: string) => Promise<readonly string[]>>(),
                    context.dependencies.database.query
                );
                const queryResult = await context.dependencies.database.query('url');

                return { url: String(queryResult[0]) };
            },
            dispose(_server, context) {
                typeScope.assert(sameType.withActual<Database>(), context.dependencies.database);
            }
        });
        return typeScope.assert.collect();
    }),
    test('infers scenario keys in resource callbacks', function (typeScope) {
        defineResource({
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
                typeScope.assert(sameType.withActual<'empty' | 'populated'>(), context.scenarios.database);

                return context.scenarios.database;
            },
            dispose(_handle, context) {
                typeScope.assert(sameType.withActual<'empty' | 'populated'>(), context.scenarios.database);
            }
        });
        return typeScope.assert.collect();
    })
]);
