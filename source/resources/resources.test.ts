import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defineResource, defineRuntime } from './resources.ts';

type Database = {
    readonly query: (sql: string) => readonly string[];
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

function assertDatabaseResourceDescriptor(scope: TestScope): void {
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
    const database = await databaseResource.acquire({ signal: disposalSignal });

    scope.assert.deepEqual(database.query('select 1'), [ 'select 1' ]);
    if (databaseResource.dispose === null) {
        throw new Error('Expected resource disposal.');
    }

    await databaseResource.dispose(database, { signal: disposalSignal });
}

function assertRuntimeDescriptor(scope: TestScope): void {
    const dimensions = { browser: 'chromium', node: '26' } as const;
    const resources = { database: databaseResource } as const;
    const runtime = defineRuntime({
        name: 'node-browser',
        dimensions,
        resources,
        requirements: [ { kind: 'single-worker' } ]
    });

    scope.assert.deepEqual(Object.keys(runtime.resources), [ 'database' ]);
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

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/resources.test.ts',
    metadata: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'defineResource returns an inert frozen descriptor',
            metadata: {},
            async body(scope: TestScope) {
                assertDatabaseResourceDescriptor(scope);
                await assertDatabaseResourceCallbacks(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'defineRuntime preserves resource keys and freezes runtime identity',
            metadata: {},
            body(scope: TestScope) {
                assertRuntimeDescriptor(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
