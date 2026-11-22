import { type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import type { HttpTranscript, HttpTranscriptEntry } from '../../../transcript/http-transcript.ts';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type SimulatedHttpServerDefinition
} from '../../../simulation/simulation.ts';
import { startFixedSimulatedHttpServer, startSimulatedHttpServer } from '../../../simulation/simulated-http-server.ts';

type AssertPostRequestBodyAssertions = { readonly assert: Pick<TestScope['assert'], 'deepEqual'>; };

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
    [ unknownResponse, missingResponse ]: readonly [Response, Response]
): Promise<void> {
    scope.assert.equal(defaultResponse.status, 200);
    scope.assert.deepEqual(await defaultResponse.json(), { key: 'default', status: 200 });
    scope.assert.equal(failureResponse.status, 500);
    scope.assert.deepEqual(await failureResponse.json(), { key: 'payments-500', status: 500 });
    scope.assert.equal(unknownResponse.status, 400);
    await unknownResponse.arrayBuffer();
    scope.assert.equal(missingResponse.status, 400);
    scope.assert.equal(await missingResponse.text(), 'Missing simulation scenario.');
}

function assertScenarioTranscript(
    scope: TestScope,
    transcript: HttpTranscript<{ readonly scenario: string | null; }>,
    baseUrl: string
): void {
    const { origin } = new URL(baseUrl);
    const failureEntry = transcript.nthEntry(1);

    scope.require.defined(failureEntry);
    scope.assert.equal(transcript.entryCount, 4);
    scope.assert.equal(failureEntry[0], 'http');
    if (failureEntry[0] === 'http') {
        scope.assert.deepEqual(failureEntry[1].context, { scenario: 'payments-500' });
        scope.assert.equal(failureEntry[1].request.url, `${origin}/checkout?cart=full`);
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
    const defaultResponse = await fetch(new URL('checkout?cart=full', server.baseUrl));
    const failureResponse = await fetch(server.scenarioUrl('payments-500', '/checkout?cart=full'));
    const unknownResponse = await fetch(new URL('/missing/checkout', server.baseUrl));

    const missingResponse = await fetch(new URL('/checkout?__overkill_scenario=default', server.baseUrl));
    await assertScenarioResponses(scope, defaultResponse, failureResponse, [ unknownResponse, missingResponse ]);
    scope.assert.deepEqual(requests, [
        'default:/checkout?cart=full',
        'payments-500:/checkout?cart=full'
    ]);
    assertScenarioTranscript(scope, server.transcript, server.baseUrl);
}

async function assertPostRequestBody(
    scope: AssertPostRequestBodyAssertions
): Promise<void> {
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
): Promise<readonly HttpTranscriptEntry<{ readonly scenario: string | null; }>[]> {
    await using server = await startSimulatedHttpServer({ simulation });
    const slowRequest = fetch(new URL('slow', server.baseUrl));

    await slowStarted.promise;
    const fastRequest = fetch(new URL('fast', server.baseUrl));

    const fastResponse = await fastRequest;
    await fastResponse.arrayBuffer();
    releaseSlowResponse.resolve(undefined);
    const slowResponse = await slowRequest;
    await slowResponse.arrayBuffer();

    return server.transcript.entries.filter(function isHttpEntry(
        entry
    ): entry is HttpTranscriptEntry<{ readonly scenario: string | null; }> {
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
    await response.arrayBuffer();
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
    await response.arrayBuffer();
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

    const response = await fetch(server.baseUrl);
    await response.arrayBuffer();

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

export const testNode: TestNode = suite('Simulated HTTP server', [
    test('routes default and URL-selected scenarios', async function (scope) {
        await assertScenarioRouting(scope);

        return scope.assert.collect();
    }),
    test(
        'simulated HTTP transcripts append by completion with request-start sequence numbers',
        async function (scope) {
            await assertCompletionOrder(scope);

            return scope.assert.collect();
        }
    ),
    test('binds a fixed scenario before listening and preserves application paths', async function (scope) {
        const simulation = defineSimulatedHttpServer({
            name: 'api',
            scenarios: { default: { title: 'Default' }, outage: { title: 'Outage' } },
            handle(request, scenario) {
                const { pathname, search } = new URL(request.url);
                return Response.json([ scenario.key, pathname, search ]);
            }
        });
        await scope.assert.rejects(async function () {
            await Reflect.apply(startFixedSimulatedHttpServer, undefined, [ { simulation, scenario: 'missing' } ]);
        }, { message: 'Unknown fixed simulation scenario.' });
        await using server = await startFixedSimulatedHttpServer({ simulation, scenario: 'outage' });
        const response = await fetch(new URL('/default/orders?limit=5', server.baseUrl));
        scope.assert.deepEqual(await response.json(), [ 'outage', '/default/orders', '?limit=5' ]);
        const entry = server.transcript.firstEntry;
        scope.assert.equal(entry?.[0] === 'http' ? entry[1].context.scenario : null, 'outage');
        return scope.assert.collect();
    }),
    test('disposal closes the listener', async function (scope) {
        await assertDisposalClosesServer(scope);

        return scope.assert.collect();
    }),
    test('forwards request bodies', async function (scope) {
        await assertPostRequestBody(scope);

        return scope.assert.collect();
    }),
    test('surfaces handler errors on disposal', async function (scope) {
        await assertHandlerErrorsFailDisposal(scope);

        return scope.assert.collect();
    }),
    test('wraps non-error handler failures on disposal', async function (scope) {
        await assertNonErrorHandlerFailuresFailDisposal(scope);

        return scope.assert.collect();
    }),
    test('rejects unbranded descriptors', async function (scope) {
        await assertInvalidSimulationRejected(scope);

        return scope.assert.collect();
    })
]);
