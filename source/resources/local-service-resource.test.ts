import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    defineLocalServiceResource,
    defineResource
} from './resources.ts';

type Database = {
    readonly query: (sql: string) => string;
};

const testSignal = new AbortController().signal;

function assertLocalServiceDescriptor(scope: TestScope): void {
    const database = defineResource({
        name: 'database',
        scope: 'per-case',
        requirements: [],
        acquire(): Database {
            return {
                query(sql) {
                    return `result:${sql}`;
                }
            };
        },
        dispose: null
    });
    const service = defineLocalServiceResource({
        name: 'redis',
        scope: 'per-case',
        requirements: [ { kind: 'single-worker' } ],
        dependencies: { database },
        host: '127.0.0.1',
        port: 0,
        start(context) {
            return {
                password: context.dependencies.database.query('password'),
                url: `redis://${context.address.host}:${context.address.port}`
            };
        },
        dispose(handle, context) {
            context.dependencies.database.query(handle.url);
        }
    });

    scope.assert.equal(service.name, 'redis');
    scope.assert.equal(service.scope, 'per-case');
    scope.assert.deepEqual(service.requirements, [ { kind: 'single-worker' } ]);
    scope.assert.deepEqual(Object.keys(service.dependencies), [ 'database' ]);
}

async function assertLocalServiceCallbacks(scope: TestScope): Promise<void> {
    const events: string[] = [];
    const service = defineLocalServiceResource({
        name: 'service',
        scope: 'per-case',
        requirements: [],
        host: '127.0.0.1',
        port: 0,
        start(context) {
            events.push(`start:${context.address.host}:${context.address.port}`);

            return { url: `http://${context.address.host}:${context.address.port}` };
        },
        dispose(handle) {
            events.push(`dispose:${handle.url}`);
        }
    });
    const handle = await service.acquire({ dependencies: {}, signal: testSignal });

    if (service.dispose === null) {
        throw new Error('Expected local-service disposal.');
    }

    await service.dispose(handle, { dependencies: {}, signal: testSignal });
    scope.assert.deepEqual(events, [
        'start:127.0.0.1:0',
        'dispose:http://127.0.0.1:0'
    ]);
}

async function assertProjectedLocalService(scope: TestScope): Promise<void> {
    const service = defineLocalServiceResource({
        name: 'mongo',
        scope: 'per-run',
        requirements: [ { kind: 'single-worker' } ],
        start(context) {
            return {
                connectionString: `mongodb://${context.address.host}:${context.address.port}`,
                password: 'secret'
            };
        },
        dispose() {
            return undefined;
        },
        serializeHandle(handle) {
            return handle.connectionString;
        },
        deserializeHandle(payload) {
            return { connectionString: String(payload) };
        }
    });
    const ownerHandle = await service.acquire({ dependencies: {}, signal: testSignal });

    scope.require.defined(service.serializeHandle);
    scope.require.defined(service.deserializeHandle);
    scope.assert.deepEqual(
        service.deserializeHandle(service.serializeHandle(ownerHandle, { dependencies: {} }), { dependencies: {} }),
        { connectionString: 'mongodb://127.0.0.1:0' }
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/local-service-resource.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local-service resources preserve lifecycle metadata',
            annotations: {},
            controls: {},
            body(scope: TestScope) {
                assertLocalServiceDescriptor(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local-service resources pass requested addresses to startup',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertLocalServiceCallbacks(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local-service resources support projected scopes',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertProjectedLocalService(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
