import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { defineMacro, suite, test } from '@overkill-dev/test';
import { httpScenarioEvidence } from '../../../test-support/http-scenario-assertions.ts';

import { resourceAttachments } from '../../../attachments/attachment-context.ts';

import { defineSimulatedHttpServer } from '../../../simulation/simulation.ts';

import { ResourceLifecycleError } from '../../../resources/resource-lifecycle-error.ts';
import { startResources } from '../../../resources/resource-session.ts';
import { defineRuntime } from '../../../resources/resources.ts';
import { startRuntime } from '../../../resources/runtime-lifecycle.ts';
import { createSimulatedHttpServerResource } from '../../../resources/simulated-http-server-resource.ts';

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

const assertSimulatedHttpResourceDescriptor = defineCompositeAssertion({
    name: 'simulated http resource descriptor',
    assert(check, resource: SimulatedHttpResourceDescriptor) {
        return check.group([
            check.equal(resource.name, 'api'),
            check.equal(resource.scope, 'per-case'),
            check.deepEqual(resource.requirements, [])
        ]);
    }
});

const assertSimulatedHttpResourceResponses = defineCompositeAssertion({
    name: 'simulated http resource responses',
    async assert(check, defaultResponse: Response, outageResponse: Response) {
        return check.group([
            check.equal(defaultResponse.status, 200),
            check.deepEqual(await defaultResponse.json(), { key: 'default' }),
            check.equal(outageResponse.status, 503),
            check.deepEqual(await outageResponse.json(), { key: 'outage' })
        ]);
    }
});

const assertSimulatedHttpResource = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const resource = createSimulatedHttpServerResource({
            simulation: defineSimulatedHttpServer({
                name: 'api',
                scenarios: {
                    default: { status: 200, title: 'standard responses' },
                    outage: { status: 503, title: 'upstream outage' }
                },
                handle(_request, scenario) {
                    return Response.json({ key: scenario.key }, { status: scenario.descriptor.status });
                }
            }),
            address: { kind: 'loopback', port: 0 }
        });
        const session = await startResources({ resources: { api: resource }, signal: testSignal() });
        const defaultResponse = await fetch(session.context.api.baseUrl);
        const outageResponse = await fetch(session.context.api.scenarioUrl('outage', '/orders'));

        scope.assert(assertSimulatedHttpResourceDescriptor, resource);
        await scope.assert(assertSimulatedHttpResourceResponses, defaultResponse, outageResponse);
        scope.assert(httpScenarioEvidence, {
            count: session.context.api.transcript.entryCount,
            entry: session.context.api.transcript.lastEntry
        }, { count: 2, scenario: 'outage', url: null });

        await session.disposeOnce({ signal: testSignal() });

        return scope.assert.collect();
    });
});

const handlerDisposalFailure = defineCompositeAssertion({
    name: 'handler failures remain attached to resource disposal',
    assert(check, failure: unknown, handlerError: Error) {
        if (!(failure instanceof ResourceLifecycleError)) {
            return check.instanceOf(failure, ResourceLifecycleError);
        }
        return check.deepEqual(failure.failures(), [ { cause: handlerError, phase: 'dispose', resourceName: 'api' } ]);
    }
});

const assertHandlerErrorsFailResourceDisposal = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const handlerError = new Error('handler exploded');
        const resource = createSimulatedHttpServerResource({
            simulation: defineSimulatedHttpServer({
                name: 'api',
                scenarios: { default: { title: 'standard responses' } },
                handle() {
                    throw handlerError;
                }
            }),
            address: { kind: 'loopback', port: 0 }
        });
        const session = await startResources({ resources: { api: resource }, signal: testSignal() });
        const response = await fetch(session.context.api.baseUrl);
        await response.arrayBuffer();
        const disposalError = await rejectedValue(session.disposeOnce({ signal: testSignal() }));

        scope.assert.equal(response.status, 500);
        scope.assert(handlerDisposalFailure, disposalError, handlerError);

        return scope.assert.collect();
    });
});

const assertExplicitResourceAddress = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const resource = createSimulatedHttpServerResource({
            simulation: defineSimulatedHttpServer({
                name: 'api',
                scenarios: { default: { title: 'standard responses' } },
                handle() {
                    return Response.json({ status: 'ok' });
                }
            }),
            address: { kind: 'host', host: '127.0.0.1', port: 0 }
        });
        const session = await startResources({ resources: { api: resource }, signal: testSignal() });

        scope.assert.equal(session.context.api.baseUrl.startsWith('http://127.0.0.1:'), true);

        await session.disposeOnce({ signal: testSignal() });

        return scope.assert.collect();
    });
});

const assertRuntimeScenarioSelectsBaseUrl = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const resource = createSimulatedHttpServerResource({
            simulation: defineSimulatedHttpServer({
                name: 'api',
                scenarios: {
                    default: { status: 200, title: 'standard responses' },
                    outage: { status: 503, title: 'upstream outage' }
                },
                handle(_request, scenario) {
                    return Response.json({ key: scenario.key }, { status: scenario.descriptor.status });
                }
            }),
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

        await scope.assert(defineCompositeAssertion({
            name: 'routes resource requests to the selected scenario',
            async assert(check) {
                return check.group([
                    check.equal(resource.scenarios.api.timing, 'request-routed'),
                    check.equal(response.status, 503),
                    check.deepEqual(await response.json(), { key: 'outage' })
                ]);
            }
        }));

        await session.disposeOnce({ signal: testSignal() });

        return scope.assert.collect();
    });
});

const assertScenarioContextFallbacks = defineMacro(function (title: string) {
    return test(title, async function (scope) {
        const resource = createSimulatedHttpServerResource({
            simulation: defineSimulatedHttpServer({
                name: 'api',
                scenarios: { default: { title: 'standard responses' } },
                handle() {
                    return Response.json({ status: 'ok' });
                }
            }),
            address: { kind: 'loopback', port: 0 }
        });
        const acquired = await resource.acquire({
            workload: null,
            attachments: resourceAttachments('test'),
            dependencies: {},
            scenarios: {},
            signal: testSignal()
        });
        const withoutScenarios: unknown = Reflect.apply(resource.exposeHandle, undefined, [ acquired, {} ]);
        const invalidScenario: unknown = Reflect.apply(resource.exposeHandle, undefined, [
            acquired,
            { scenarios: { api: 1 } }
        ]);

        scope.assert.deepEqual([
            typeof Reflect.get(withoutScenarios as Readonly<Record<string, unknown>>, 'baseUrl'),
            typeof Reflect.get(invalidScenario as Readonly<Record<string, unknown>>, 'baseUrl')
        ], [ 'string', 'string' ]);
        if (resource.dispose === null) {
            throw new Error('Expected resource disposal.');
        }

        const context = {
            workload: null,
            attachments: resourceAttachments('test'),
            dependencies: {},
            scenarios: { api: 'default' as const },
            signal: testSignal()
        };

        scope.assert.deepEqual(
            await Promise.all([
                resource.dispose({} as never, context),
                resource.dispose(acquired, context)
            ]),
            [ undefined, undefined ]
        );

        return scope.assert.collect();
    });
});

export const testNode = suite('Simulated HTTP server resource', [
    assertSimulatedHttpResource('simulated HTTP server resources expose acquired server handles'),
    assertHandlerErrorsFailResourceDisposal('simulated HTTP server resources fail disposal after handler errors'),
    assertExplicitResourceAddress('simulated HTTP server resources pass explicit addresses'),
    assertRuntimeScenarioSelectsBaseUrl('runtime scenarios select simulated HTTP base URLs'),
    assertScenarioContextFallbacks('simulated HTTP resources default malformed scenario contexts')
]);
