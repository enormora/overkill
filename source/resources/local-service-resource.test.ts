import { createServer } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    createLocalHttpServiceResource
} from './local-http-service-resource.ts';
import {
    createLocalProcessServiceResource,
    type LocalProcessOwner
} from './local-process-service-resource.ts';
import {
    defineLocalServiceResource
} from './local-service-resource.ts';
import {
    defineResource,
    type EmptyResourceDependencies,
    type ResourceDefinition
} from './resources.ts';
import { ResourceLifecycleError } from './resource-lifecycle-error.ts';
import { startResources } from './resource-session.ts';

type Database = {
    readonly query: (sql: string) => string;
};

const testController = new AbortController();
const testSignal = testController.signal;

function testDatabase(): ResourceDefinition<'database', Database, EmptyResourceDependencies> {
    return defineResource({
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
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected promise rejection.');
}

async function waitForOutput(owner: LocalProcessOwner, value: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (owner.output.stdout.text().includes(value)) {
            return;
        }

        await wait(10);
    }

    throw new Error(`Process output did not include "${value}".`);
}

function assertLocalServiceDescriptor(scope: TestScope): void {
    const database = testDatabase();
    const service = defineLocalServiceResource({
        name: 'redis',
        scope: 'per-case',
        requirements: [ { kind: 'single-worker' } ],
        dependencies: { database },
        address: { kind: 'loopback', port: 0 },
        start(context) {
            return {
                password: context.dependencies.database.query('password')
            };
        },
        ready(owner, context) {
            return Object.freeze({
                password: owner.password,
                url: `redis://${context.address.host}:${context.address.port}`
            });
        },
        dispose(owner, context) {
            context.dependencies.database.query(owner.password);
        }
    });

    scope.assert.equal(service.name, 'redis');
    scope.assert.equal(service.scope, 'per-case');
    scope.assert.deepEqual(service.requirements, [ { kind: 'single-worker' } ]);
    scope.assert.deepEqual(Object.keys(service.dependencies), [ 'database' ]);
}

async function assertOwnerCleanup(scope: TestScope): Promise<void> {
    const events: string[] = [];
    const service = defineLocalServiceResource({
        name: 'service',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'host', host: '127.0.0.1', port: 0 },
        start(context) {
            events.push(`start:${context.address.host}:${context.address.port}`);

            return { id: 'owner' };
        },
        ready(owner, context) {
            events.push(`ready:${owner.id}`);

            return Object.freeze({ url: `http://${context.address.host}:${context.address.port}` });
        },
        dispose(owner) {
            events.push(`dispose:${owner.id}`);
        }
    });
    const handle = await service.acquire({ dependencies: {}, signal: testSignal });

    if (service.dispose === null) {
        throw new Error('Expected local-service disposal.');
    }

    await service.dispose(handle, { dependencies: {}, signal: testSignal });
    await service.dispose(handle, { dependencies: {}, signal: testSignal });
    scope.assert.deepEqual(events, [
        'start:127.0.0.1:0',
        'ready:owner',
        'dispose:owner'
    ]);
}

async function assertReadinessFailureCleanup(scope: TestScope): Promise<void> {
    const events: string[] = [];
    const readyError = new Error('not ready');
    const service = defineLocalServiceResource({
        name: 'service',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        start() {
            events.push('start');

            return { id: 'owner' };
        },
        ready() {
            events.push('ready');
            throw readyError;
        },
        dispose(owner) {
            events.push(`dispose:${owner.id}`);
        }
    });
    const error = await rejectedValue(service.acquire({ dependencies: {}, signal: testSignal }));

    scope.assert.equal(error, readyError);
    scope.assert.deepEqual(events, [ 'start', 'ready', 'dispose:owner' ]);
}

async function assertProjectedLocalService(scope: TestScope): Promise<void> {
    const database = testDatabase();
    const service = defineLocalServiceResource({
        name: 'mongo',
        scope: 'per-run',
        requirements: [ { kind: 'single-worker' } ],
        dependencies: { database },
        address: { kind: 'loopback', port: 0 },
        start(context) {
            return {
                dependencyPassword: context.dependencies.database.query('password'),
                password: 'secret'
            };
        },
        ready(owner, context) {
            return Object.freeze({
                connectionString: `mongodb://${context.address.host}:${context.address.port}`,
                dependencyPassword: owner.dependencyPassword
            });
        },
        dispose() {
            return undefined;
        },
        serializeHandle(handle) {
            return handle.connectionString;
        },
        deserializeHandle(payload) {
            return { connectionString: payload };
        }
    });
    const ownerHandle = await service.acquire({
        dependencies: {
            database: {
                query(sql) {
                    return `runtime:${sql}`;
                }
            }
        },
        signal: testSignal
    });

    scope.require.defined(service.serializeHandle);
    scope.require.defined(service.deserializeHandle);
    scope.assert.equal(ownerHandle.dependencyPassword, 'runtime:password');
    scope.assert.deepEqual(
        service.deserializeHandle(
            service.serializeHandle(ownerHandle, {
                dependencies: {
                    database: {
                        query(sql) {
                            return `runtime:${sql}`;
                        }
                    }
                }
            }),
            {
                dependencies: {
                    database: {
                        query(sql) {
                            return `runtime:${sql}`;
                        }
                    }
                }
            }
        ),
        { connectionString: 'mongodb://127.0.0.1:0' }
    );
}

async function assertLocalHttpService(scope: TestScope): Promise<void> {
    const service = createLocalHttpServiceResource({
        name: 'app',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        createServer() {
            return createServer(function respond(_request, response) {
                response.end('ready');
            });
        },
        handle(handle) {
            return handle;
        },
        dispose() {
            return undefined;
        }
    });
    const session = await startResources({ resources: { app: service }, signal: testSignal });
    const response = await fetch(session.context.app.baseUrl);

    scope.assert.equal(session.context.app.endpoint.host, '127.0.0.1');
    scope.assert.equal(session.context.app.endpoint.port > 0, true);
    scope.assert.equal(await response.text(), 'ready');

    await session.disposeOnce({ signal: testSignal });
    scope.assert.equal(await rejectedValue(fetch(session.context.app.baseUrl)) instanceof Error, true);
}

async function assertLocalProcessService(scope: TestScope): Promise<void> {
    const service = createLocalProcessServiceResource({
        name: 'daemon',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        outputBufferBytes: 64,
        shutdown: {
            gracefulSignal: 'SIGTERM',
            forceSignal: 'SIGKILL',
            graceMilliseconds: 100
        },
        command() {
            return {
                command: process.execPath,
                arguments: [
                    '-e',
                    'process.stdout.write("ready"); setInterval(function keepAlive() {}, 1000);'
                ],
                environment: {},
                workingDirectory: null
            };
        },
        async ready(owner) {
            await waitForOutput(owner, 'ready');

            return Object.freeze({
                output: owner.output.stdout.text()
            });
        }
    });
    const session = await startResources({ resources: { daemon: service }, signal: testSignal });

    scope.assert.equal(session.context.daemon.output, 'ready');
    await session.disposeOnce({ signal: testSignal });
}

async function assertProcessEarlyExit(scope: TestScope): Promise<void> {
    const service = createLocalProcessServiceResource({
        name: 'daemon',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        outputBufferBytes: 64,
        shutdown: {
            gracefulSignal: 'SIGTERM',
            forceSignal: 'SIGKILL',
            graceMilliseconds: 100
        },
        command() {
            return {
                command: process.execPath,
                arguments: [ '-e', 'process.stderr.write("startup failed"); process.exit(7);' ],
                environment: {},
                workingDirectory: null
            };
        },
        async ready(owner) {
            await waitForOutput(owner, 'never');

            return Object.freeze({ output: owner.output.stderr.text() });
        }
    });
    const error = await rejectedValue(startResources({ resources: { daemon: service }, signal: testSignal }));

    scope.require.instanceOf(error, ResourceLifecycleError);
    scope.assert.match(String(error.failures()[0]?.cause), /startup failed/u);
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
            title: 'local-service resources hide owner handles and dispose once',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertOwnerCleanup(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local-service resources clean up after readiness failures',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertReadinessFailureCleanup(scope);

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
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP service resources expose ready loopback endpoints',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertLocalHttpService(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local process service resources expose readiness handles',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertLocalProcessService(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local process service resources fail when processes exit before readiness',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertProcessEarlyExit(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
