import { test } from '../../../tools/type-tests/authoring.entry-point.ts';
import { rejectsCall } from '../../../tools/type-tests/relations.entry-point.ts';
import {
    defineResource,
    type defineRuntime
} from './resources.entry-point.ts';

type Database = {
    readonly query: (sql: string) => Promise<readonly string[]>;
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

function createInvalidDatabase(): Database {
    return {
        async query(sql: string) {
            return [ sql ];
        }
    };
}

declare const defineResourceUnderTest: typeof defineResource;
declare const defineRuntimeUnderTest: typeof defineRuntime;

export const testNode = test('keeps invalid shapes out of typed descriptors', function (typeScope) {
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
});
