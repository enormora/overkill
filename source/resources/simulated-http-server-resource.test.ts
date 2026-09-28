import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defineSimulatedHttpServer } from '../simulation/simulation.ts';
import { ResourceLifecycleError } from './resource-lifecycle-error.ts';
import { startResources } from './resource-session.ts';
import { defineRuntime } from './resources.ts';
import { startRuntime } from './runtime-lifecycle.ts';
import {
    createSimulatedHttpServerResource
} from './simulated-http-server-resource.ts';

type SimulatedHttpResourceDescriptor = {
    readonly name: string;
    readonly requirements: readonly unknown[];
    readonly scope: string;
};

function testSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error: unknown) {
        return error;
    }

    throw new Error('Expected promise rejection.');
}

function assertSimulatedHttpResourceDescriptor(
    scope: TestScope,
    resource: SimulatedHttpResourceDescriptor
): void {
    scope.assert.equal(resource.name, 'api');
    scope.assert.equal(resource.scope, 'per-case');
    scope.assert.deepEqual(resource.requirements, []);
}

async function assertSimulatedHttpResourceResponses(
    scope: TestScope,
    defaultResponse: Response,
    outageResponse: Response
): Promise<void> {
    scope.assert.equal(defaultResponse.status, 200);
    scope.assert.deepEqual(await defaultResponse.json(), { key: 'default' });
    scope.assert.equal(outageResponse.status, 503);
    scope.assert.deepEqual(await outageResponse.json(), { key: 'outage' });
}

async function assertSimulatedHttpResource(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: {
            default: { status: 200, title: 'standard responses' },
            outage: { status: 503, title: 'upstream outage' }
        },
        handle(_request, scenario) {
            return Response.json({ key: scenario.key }, { status: scenario.descriptor.status });
        }
    });
    const resource = createSimulatedHttpServerResource({
        simulation,
        address: { kind: 'loopback', port: 0 }
    });
    const session = await startResources({ resources: { api: resource }, signal: testSignal() });
    const defaultResponse = await fetch(session.context.api.baseUrl);
    const outageResponse = await fetch(session.context.api.scenarioUrl('outage', '/orders'));

    assertSimulatedHttpResourceDescriptor(scope, resource);
    await assertSimulatedHttpResourceResponses(scope, defaultResponse, outageResponse);

    await session.disposeOnce({ signal: testSignal() });
}

async function assertHandlerErrorsFailResourceDisposal(scope: TestScope): Promise<void> {
    const handlerError = new Error('handler exploded');
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        handle() {
            throw handlerError;
        }
    });
    const resource = createSimulatedHttpServerResource({
        simulation,
        address: { kind: 'loopback', port: 0 }
    });
    const session = await startResources({ resources: { api: resource }, signal: testSignal() });
    const response = await fetch(session.context.api.baseUrl);
    const disposalError = await rejectedValue(session.disposeOnce({ signal: testSignal() }));

    scope.assert.equal(response.status, 500);
    scope.require.instanceOf(disposalError, ResourceLifecycleError);
    scope.assert.deepEqual(disposalError.failures(), [
        {
            cause: handlerError,
            phase: 'dispose',
            resourceName: 'api'
        }
    ]);
}

async function assertExplicitResourceAddress(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        handle() {
            return Response.json({ status: 'ok' });
        }
    });
    const resource = createSimulatedHttpServerResource({
        simulation,
        address: { kind: 'host', host: '127.0.0.1', port: 0 }
    });
    const session = await startResources({ resources: { api: resource }, signal: testSignal() });

    scope.assert.equal(session.context.api.baseUrl.startsWith('http://127.0.0.1:'), true);

    await session.disposeOnce({ signal: testSignal() });
}

async function assertRuntimeScenarioSelectsBaseUrl(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: {
            default: { status: 200, title: 'standard responses' },
            outage: { status: 503, title: 'upstream outage' }
        },
        handle(_request, scenario) {
            return Response.json({ key: scenario.key }, { status: scenario.descriptor.status });
        }
    });
    const resource = createSimulatedHttpServerResource({
        simulation,
        address: { kind: 'loopback', port: 0 }
    });
    const runtime = defineRuntime({
        name: 'api-runtime',
        dimensions: {},
        resources: { api: resource },
        requirements: []
    })
        .scenario({ api: 'outage' });
    const session = await startRuntime({ runtime, signal: testSignal() });
    const response = await fetch(session.context.api.baseUrl);

    scope.assert.equal(resource.scenarios.api.timing, 'request-routed');
    scope.assert.equal(response.status, 503);
    scope.assert.deepEqual(await response.json(), { key: 'outage' });

    await session.disposeOnce({ signal: testSignal() });
}

async function assertScenarioContextFallbacks(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        handle() {
            return Response.json({ status: 'ok' });
        }
    });
    const resource = createSimulatedHttpServerResource({
        simulation,
        address: { kind: 'loopback', port: 0 }
    });
    const signal = testSignal();
    const acquisitions = [
        Promise.resolve(resource.acquire({ dependencies: {}, signal } as never)),
        Promise.resolve(resource.acquire({ dependencies: {}, scenarios: { api: 1 }, signal } as never))
    ] as const;
    const [ withoutScenarios, invalidScenario ] = await Promise.all(acquisitions);

    scope.assert.deepEqual([
        typeof Reflect.get(withoutScenarios as Readonly<Record<string, unknown>>, 'baseUrl'),
        typeof Reflect.get(invalidScenario as Readonly<Record<string, unknown>>, 'baseUrl')
    ], [ 'string', 'string' ]);
    if (resource.dispose === null) {
        throw new Error('Expected resource disposal.');
    }

    const context = { dependencies: {}, scenarios: { api: 'default' as const }, signal };

    scope.assert.deepEqual(
        await Promise.all([
            resource.dispose({} as never, context),
            resource.dispose(withoutScenarios as never, context),
            resource.dispose(invalidScenario as never, context)
        ]),
        [ undefined, undefined, undefined ]
    );
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/simulated-http-server-resource.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server resources expose acquired server handles',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertSimulatedHttpResource(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server resources fail disposal after handler errors',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertHandlerErrorsFailResourceDisposal(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server resources pass explicit addresses',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertExplicitResourceAddress(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'runtime scenarios select simulated HTTP base URLs',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertRuntimeScenarioSelectsBaseUrl(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP resources default malformed scenario contexts',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertScenarioContextFallbacks(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
