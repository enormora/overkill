import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, suite, test, type TestScope } from '@overkill-dev/test';
import { httpScenarioEvidence } from '../../../test-support/http-scenario-assertions.ts';

import type { HttpTranscriptEntry } from '../../../transcript/http-transcript.ts';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type SimulatedHttpServerDefinition
} from '../../../simulation/simulation.ts';
import { startFixedSimulatedHttpServer, startSimulatedHttpServer } from '../../../simulation/simulated-http-server.ts';

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

async function requestScenarioResponses(
    baseUrl: string,
    failureUrl: string
): Promise<readonly [Response, Response, Response, Response]> {
    return [
        await fetch(new URL('checkout?cart=full', baseUrl)),
        await fetch(failureUrl),
        await fetch(new URL('/missing/checkout', baseUrl)),
        await fetch(new URL('/checkout?__overkill_scenario=default', baseUrl))
    ];
}

const assertScenarioResponses = defineCompositeAssertion({
    name: 'scenario responses',
    async assert(
        check,
        defaultResponse: Response,
        failureResponse: Response,
        unknownResponses: readonly [Response, Response]
    ) {
        const [ unknownResponse, missingResponse ] = unknownResponses;
        const initialChecks = check.group([
            check.equal(defaultResponse.status, 200),
            check.deepEqual(await defaultResponse.json(), { key: 'default', status: 200 }),
            check.equal(failureResponse.status, 500),
            check.deepEqual(await failureResponse.json(), { key: 'payments-500', status: 500 }),
            check.equal(unknownResponse.status, 400)
        ]);
        await unknownResponse.arrayBuffer();
        return check.group([
            initialChecks,
            check.equal(missingResponse.status, 400),
            check.equal(await missingResponse.text(), 'Missing simulation scenario.')
        ]);
    }
});

const assertScenarioRouting = defineMacro(function (title: string) {
    return test(title, async function (scope) {
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
        const [ defaultResponse, failureResponse, unknownResponse, missingResponse ] = await requestScenarioResponses(
            server.baseUrl,
            server.scenarioUrl('payments-500', '/checkout?cart=full')
        );
        await scope.assert(assertScenarioResponses, defaultResponse, failureResponse, [
            unknownResponse,
            missingResponse
        ]);
        const { origin } = new URL(server.baseUrl);
        scope.assert.deepEqual(requests, [
            'default:/checkout?cart=full',
            'payments-500:/checkout?cart=full'
        ]);
        scope.assert(httpScenarioEvidence, {
            count: server.transcript.entryCount,
            entry: server.transcript.nthEntry(1)
        }, { count: 4, scenario: 'payments-500', url: origin + '/checkout?cart=full' });

        return scope.assert.collect();
    });
});

const assertPostRequestBody = defineCompositeAssertion({
    name: 'POST handlers receive their request body',
    async assert(check) {
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

        const actual: unknown = await response.json();
        return check.deepEqual(actual, {
            body: 'checkout=true',
            method: 'POST'
        });
    }
});

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

const assertDisposalClosesServer = defineMacro(function (title: string) {
    return test(title, async function (scope) {
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

        return scope.assert.collect();
    });
});

const assertHandlerErrorsFailDisposal = defineMacro(function (title: string) {
    return test(title, async function (scope) {
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

        return scope.assert.collect();
    });
});

const assertNonErrorHandlerFailuresFailDisposal = defineMacro(function (title: string) {
    return test(title, async function (scope: TestScope) {
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

        return scope.assert.collect();
    });
});

const assertInvalidSimulationRejected = defineMacro(function (title: string) {
    return test(title, async function (scope: TestScope) {
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

        return scope.assert.collect();
    });
});

export const testNode = suite('Simulated HTTP server', [
    assertScenarioRouting('routes default and URL-selected scenarios'),
    test('simulated HTTP transcripts append by completion with request-start sequence numbers', async function (scope) {
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

        return scope.assert.collect();
    }),
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
    assertDisposalClosesServer('disposal closes the listener'),
    test('forwards request bodies', async function (scope) {
        await scope.assert(assertPostRequestBody);

        return scope.assert.collect();
    }),
    assertHandlerErrorsFailDisposal('surfaces handler errors on disposal'),
    assertNonErrorHandlerFailuresFailDisposal('wraps non-error handler failures on disposal'),
    assertInvalidSimulationRejected('rejects unbranded descriptors')
]);
