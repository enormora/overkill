import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defineSimulatedHttpServer } from '../simulation/simulation.ts';
import { ResourceLifecycleError } from './resource-lifecycle-error.ts';
import { startResources } from './resource-session.ts';
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
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
