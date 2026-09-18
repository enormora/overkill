import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { defineSimulatedHttpServer } from './simulation.ts';
import { startSimulatedHttpServer } from './simulated-http-server.ts';

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

async function assertScenarioRouting(scope: TestScope): Promise<void> {
    const requests: string[] = [];
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: {
            default: { status: 200, title: 'standard responses' },
            'payments-500': { status: 500, title: 'payment service fails' }
        },
        handle(request, scenario) {
            const url = new URL(request.url);

            requests.push(`${scenario.key}:${url.pathname}${url.search}`);

            return Response.json({
                key: scenario.key,
                status: scenario.descriptor.status
            }, { status: scenario.descriptor.status });
        }
    });
    await using server = await startSimulatedHttpServer({ simulation });
    const defaultResponse = await fetch(`${server.baseUrl}/checkout?cart=full`);
    const failureResponse = await fetch(server.scenarioUrl('payments-500', '/checkout?cart=full'));
    const unknownResponse = await fetch(`${server.baseUrl}/checkout?__overkill_scenario=missing`);

    scope.assert.equal(defaultResponse.status, 200);
    scope.assert.deepEqual(await defaultResponse.json(), { key: 'default', status: 200 });
    scope.assert.equal(failureResponse.status, 500);
    scope.assert.deepEqual(await failureResponse.json(), { key: 'payments-500', status: 500 });
    scope.assert.equal(unknownResponse.status, 400);
    scope.assert.deepEqual(requests, [
        'default:/checkout?cart=full',
        'payments-500:/checkout?cart=full'
    ]);
}

async function assertDisposalClosesServer(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        handle() {
            return Response.json({ status: 'ok' });
        }
    });
    const server = await startSimulatedHttpServer({ simulation });
    const baseUrl = server.baseUrl;

    scope.assert.equal((await fetch(baseUrl)).status, 200);
    await server.dispose();
    scope.assert.equal(await rejectedValue(fetch(baseUrl, { signal: testSignal() })) instanceof Error, true);
}

async function assertHandlerErrorsFailDisposal(scope: TestScope): Promise<void> {
    const handlerError = new Error('handler exploded');
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        handle() {
            throw handlerError;
        }
    });
    const server = await startSimulatedHttpServer({ simulation });
    const response = await fetch(server.baseUrl);
    const disposalError = await rejectedValue(server.dispose());

    scope.assert.equal(response.status, 500);
    scope.assert.equal(disposalError, handlerError);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/simulation/simulated-http-server.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server routes default and URL-selected scenarios',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertScenarioRouting(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server disposal closes the listener',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertDisposalClosesServer(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server surfaces handler errors on disposal',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertHandlerErrorsFailDisposal(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
