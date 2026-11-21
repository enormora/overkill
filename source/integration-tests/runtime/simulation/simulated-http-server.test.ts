import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, suite, test, type TestScope } from '@overkill-dev/test';

import type { HttpTranscript, HttpTranscriptEntry } from '../../../transcript/http-transcript.ts';
import {
    defineSimulatedHttpServer,
    defineSimulation,
    type SimulatedHttpServerDefinition
} from '../../../simulation/simulation.ts';
import { startSimulatedHttpServer } from '../../../simulation/simulated-http-server.ts';

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

const assertScenarioResponses = defineCompositeAssertion({
    name: 'scenario responses',
    async assert(check, defaultResponse: Response, failureResponse: Response, unknownResponse: Response) {
        const initialChecks = check.group([
            check.equal(defaultResponse.status, 200),
            check.deepEqual(await defaultResponse.json(), { key: 'default', status: 200 }),
            check.equal(failureResponse.status, 500),
            check.deepEqual(await failureResponse.json(), { key: 'payments-500', status: 500 }),
            check.equal(unknownResponse.status, 400)
        ]);
        await unknownResponse.arrayBuffer();
        return initialChecks;
    }
});

const assertScenarioRouting = defineMacro((title: string) =>
    test(title, async (scope: TestScope) => {
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

        await scope.assert(assertScenarioResponses, defaultResponse, failureResponse, unknownResponse);
        scope.assert.deepEqual(requests, [
            'default:/checkout?cart=full',
            'payments-500:/checkout?cart=full'
        ]);
        const scenarioTranscriptTranscript: HttpTranscript<{ readonly scenario: string; }> = server.transcript;
        const scenarioTranscriptBaseUrl: string = server.baseUrl;
        const scenarioTranscriptFailureEntry = scenarioTranscriptTranscript.nthEntry(1);

        scope.require.defined(scenarioTranscriptFailureEntry);
        scope.assert.equal(scenarioTranscriptTranscript.entryCount, 3);
        scope.assert.equal(scenarioTranscriptFailureEntry[0], 'http');
        if (scenarioTranscriptFailureEntry[0] === 'http') {
            scope.assert.deepEqual(scenarioTranscriptFailureEntry[1].context, { scenario: 'payments-500' });
            scope.assert.equal(
                scenarioTranscriptFailureEntry[1].request.url,
                `${scenarioTranscriptBaseUrl}/checkout?cart=full`
            );
        }

        return scope.assert.collect();
    })
);

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
): Promise<readonly HttpTranscriptEntry<{ readonly scenario: string; }>[]> {
    await using server = await startSimulatedHttpServer({ simulation });
    const slowRequest = fetch(`${server.baseUrl}/slow`);

    await slowStarted.promise;
    const fastRequest = fetch(`${server.baseUrl}/fast`);

    const fastResponse = await fastRequest;
    await fastResponse.arrayBuffer();
    releaseSlowResponse.resolve(undefined);
    const slowResponse = await slowRequest;
    await slowResponse.arrayBuffer();

    return server.transcript.entries.filter(function isHttpEntry(
        entry
    ): entry is HttpTranscriptEntry<{ readonly scenario: string; }> {
        return entry[0] === 'http';
    });
}

const assertDisposalClosesServer = defineMacro((title: string) =>
    test(title, async (scope) => {
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
    })
);

const assertHandlerErrorsFailDisposal = defineMacro((title: string) =>
    test(title, async (scope) => {
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
    })
);

const assertNonErrorHandlerFailuresFailDisposal = defineMacro((title: string) =>
    test(title, async (scope: TestScope) => {
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
    })
);

const assertInvalidSimulationRejected = defineMacro((title: string) =>
    test(title, async (scope: TestScope) => {
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
    })
);

export const testNode = suite('Simulated HTTP server', [
    assertScenarioRouting('routes default and URL-selected scenarios'),
    test('simulated HTTP transcripts append by completion with request-start sequence numbers', async (scope) => {
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
    assertDisposalClosesServer('disposal closes the listener'),
    test('forwards request bodies', async function (scope) {
        await assertPostRequestBody(scope);

        return scope.assert.collect();
    }),
    assertHandlerErrorsFailDisposal('surfaces handler errors on disposal'),
    assertNonErrorHandlerFailuresFailDisposal('wraps non-error handler failures on disposal'),
    assertInvalidSimulationRejected('rejects unbranded descriptors')
]);
