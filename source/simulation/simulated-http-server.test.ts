import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import type { HttpTranscript, HttpTranscriptEntry } from '../transcript/http-transcript.ts';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type SimulatedHttpServerDefinition
} from './simulation.ts';
import { startSimulatedHttpServer } from './simulated-http-server.ts';

type CompletionOrderScenarios = {
    readonly default: { readonly title: 'standard responses'; };
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

async function startInvalidSimulation(value: unknown): Promise<void> {
    await Reflect.apply(startSimulatedHttpServer, undefined, [ {
        simulation: value
    } ]);
}

async function assertScenarioResponses(
    scope: TestScope,
    defaultResponse: Response,
    failureResponse: Response,
    unknownResponse: Response
): Promise<void> {
    scope.assert.equal(defaultResponse.status, 200);
    scope.assert.deepEqual(await defaultResponse.json(), { key: 'default', status: 200 });
    scope.assert.equal(failureResponse.status, 500);
    scope.assert.deepEqual(await failureResponse.json(), { key: 'payments-500', status: 500 });
    scope.assert.equal(unknownResponse.status, 400);
}

function assertScenarioTranscript(
    scope: TestScope,
    transcript: HttpTranscript<{ readonly scenario: string; }>,
    baseUrl: string
): void {
    const failureEntry = transcript.nthEntry(1);

    scope.require.defined(failureEntry);
    scope.assert.equal(transcript.entryCount, 3);
    scope.assert.equal(failureEntry[0], 'http');
    if (failureEntry[0] === 'http') {
        scope.assert.deepEqual(failureEntry[1].context, { scenario: 'payments-500' });
        scope.assert.equal(failureEntry[1].request.url, `${baseUrl}/checkout?cart=full`);
    }
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

    await assertScenarioResponses(scope, defaultResponse, failureResponse, unknownResponse);
    scope.assert.deepEqual(requests, [
        'default:/checkout?cart=full',
        'payments-500:/checkout?cart=full'
    ]);
    assertScenarioTranscript(scope, server.transcript, server.baseUrl);
}

async function assertPostRequestBody(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        async handle(request) {
            return Response.json({
                body: await request.text(),
                method: request.method
            });
        }
    });
    await using server = await startSimulatedHttpServer({ simulation });
    const response = await fetch(server.baseUrl, {
        body: 'checkout=true',
        method: 'POST'
    });

    scope.assert.deepEqual(await response.json(), {
        body: 'checkout=true',
        method: 'POST'
    });
}

function completionOrderSimulation(
    slowStarted: PromiseWithResolvers<undefined>,
    releaseSlowResponse: PromiseWithResolvers<undefined>
): SimulatedHttpServerDefinition<'api', CompletionOrderScenarios> {
    return defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        async handle(request) {
            const url = new URL(request.url);

            if (url.pathname === '/slow') {
                slowStarted.resolve(undefined);
                await releaseSlowResponse.promise;
            }

            return new Response('ready');
        }
    });
}

async function completionOrderedEntries(
    simulation: SimulatedHttpServerDefinition<'api', CompletionOrderScenarios>,
    slowStarted: PromiseWithResolvers<undefined>,
    releaseSlowResponse: PromiseWithResolvers<undefined>
): Promise<readonly HttpTranscriptEntry<{ readonly scenario: string; }>[]> {
    await using server = await startSimulatedHttpServer({ simulation });
    const slowRequest = fetch(`${server.baseUrl}/slow`);

    await slowStarted.promise;
    const fastRequest = fetch(`${server.baseUrl}/fast`);

    await fastRequest;
    releaseSlowResponse.resolve(undefined);
    await slowRequest;

    return server.transcript.entries.filter(function isHttpEntry(
        entry
    ): entry is HttpTranscriptEntry<{ readonly scenario: string; }> {
        return entry[0] === 'http';
    });
}

async function assertCompletionOrder(scope: TestScope): Promise<void> {
    const slowStarted = Promise.withResolvers<undefined>();
    const releaseSlowResponse = Promise.withResolvers<undefined>();
    const simulation = completionOrderSimulation(slowStarted, releaseSlowResponse);
    const entries = await completionOrderedEntries(simulation, slowStarted, releaseSlowResponse);

    scope.assert.deepEqual(
        entries.map(function requestPath(entry) {
            const url = new URL(entry[1].request.url);

            return url.pathname;
        }),
        [ '/fast', '/slow' ]
    );
    scope.assert.deepEqual(
        entries.map(function (entry) {
            return entry[1].sequence;
        }),
        [ 1, 0 ]
    );
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
    const { baseUrl } = server;

    const response = await fetch(baseUrl);

    scope.assert.equal(response.status, 200);
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

async function assertNonErrorHandlerFailuresFailDisposal(scope: TestScope): Promise<void> {
    const simulation = defineSimulatedHttpServer({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } },
        handle() {
            return new Response(
                new ReadableStream({
                    start(controller) {
                        controller.error('handler exploded');
                    }
                })
            );
        }
    });
    const server = await startSimulatedHttpServer({ simulation });

    await fetch(server.baseUrl);

    const disposalError = await rejectedValue(server.dispose());

    scope.require.instanceOf(disposalError, Error);
    scope.assert.equal(disposalError.message, 'Simulation handler failed with a non-error value.');
}

async function assertInvalidSimulationRejected(scope: TestScope): Promise<void> {
    const invalidSimulation = defineSimulation({
        name: 'api',
        scenarios: { default: { title: 'standard responses' } }
    });

    const startupError = await rejectedValue(startInvalidSimulation(invalidSimulation));

    scope.require.instanceOf(startupError, TypeError);
    scope.assert.equal(
        startupError.message,
        'startSimulatedHttpServer() requires a simulated HTTP server definition.'
    );
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
            title: 'simulated HTTP transcripts append by completion with request-start sequence numbers',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertCompletionOrder(scope);

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
            title: 'simulated HTTP server forwards request bodies',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertPostRequestBody(scope);

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
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server wraps non-error handler failures on disposal',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertNonErrorHandlerFailuresFailDisposal(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'simulated HTTP server rejects unbranded descriptors',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertInvalidSimulationRejected(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
