import { z } from 'zod/v4';
import { runIfMain } from '#test-runner';
import { serializeProjectedHandle, deserializeProjectedHandle } from '../run/resource-lifecycle-projection.ts';
import {
    type LocalHttpServerFixture,
    localHttpServer,
    type HttpServerFaults
} from '../test-support/local-http-server.ts';
import { suite, test, type TestScope } from '../packages/test/test.entry-point.ts';
import { resourceAttachments } from '../attachments/attachment-context.ts';
import { emptyTranscriptView } from '../transcript/http-transcript.ts';
import {
    type LocalHttpServiceResourceInput,
    type LocalHttpResourceHandle,
    type LocalHttpServiceHandle,
    createLocalHttpServiceResource,
    type LocalHttpTranscriptPolicy
} from './local-http-service-resource.ts';
import type { EmptyResourceDependencies } from './resource-definition-shape.ts';
import type { ResourceCreationContext, ResourceDefinition } from './resource-definition-types.ts';

const noFaults: HttpServerFaults = { listen: null, close: null, address: 'tcp' };
function resourceContext(): ResourceCreationContext {
    return {
        workload: null,
        attachments: resourceAttachments('test'),
        dependencies: {},
        scenarios: {},
        signal: AbortSignal.any([])
    };
}
type HttpServiceConsumer = { readonly baseUrl: string; };
type HttpServiceFixture = LocalHttpServerFixture & {
    readonly faults: HttpServerFaults;
    readonly input: LocalHttpServiceResourceInput<'http', HttpServiceConsumer, 'per-case', EmptyResourceDependencies>;
    readonly context: ResourceCreationContext;
    readonly lifecycle: readonly string[];
    readonly service: ResourceDefinition<
        'http',
        LocalHttpResourceHandle<HttpServiceConsumer, unknown>,
        EmptyResourceDependencies
    >;
};
function httpService(policy: LocalHttpTranscriptPolicy | null, faults: HttpServerFaults): HttpServiceFixture {
    const fixture = localHttpServer(faults);
    const calls: string[] = [];
    const input = {
        name: 'http',
        scope: 'per-case',
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        createServer() {
            calls.push('create');
            return fixture.server;
        },
        handle(service: LocalHttpServiceHandle) {
            calls.push('handle');
            return { baseUrl: service.baseUrl };
        },
        dispose() {
            calls.push('dispose');
        }
    } as const;
    const policies: readonly [] | readonly [LocalHttpTranscriptPolicy] = policy === null ? [] : [ policy ];
    const service = createLocalHttpServiceResource(input, ...policies);
    return { ...fixture, faults, input, context: resourceContext(), lifecycle: calls, service };
}
const transcriptPolicies: readonly (LocalHttpTranscriptPolicy | null)[] = [
    null,
    { kind: 'disabled' },
    {
        kind: 'custom',
        transcript: emptyTranscriptView
    }
];
export const testNode = suite('local HTTP resource ownership', [
    test('projects per-run HTTP handles with an empty consumer transcript', function (scope: TestScope) {
        const fixture = httpService(null, noFaults);
        const resource = createLocalHttpServiceResource({
            ...fixture.input,
            scope: 'per-run',
            serializeHandle(handle: HttpServiceConsumer) {
                return handle.baseUrl;
            },
            deserializeHandle(baseUrl: string) {
                return { baseUrl };
            }
        });
        scope.assert.equal(resource.scope, 'per-run');
        scope.assert.deepEqual<unknown, unknown>(serializeProjectedHandle(resource, { baseUrl: 'http://owner' }, {}), {
            payload: 'http://owner'
        });
        const handle = z.object({ baseUrl: z.string(), transcript: z.object({ entryCount: z.number() }) }).parse(
            deserializeProjectedHandle(resource, 'http://consumer', {})
        );
        scope.assert.deepEqual(handle, {
            baseUrl: 'http://consumer',
            transcript: { entryCount: 0 }
        });
        scope.assert.deepEqual(fixture.lifecycle, []);
        return scope.assert.collect();
    }),
    ...([ 'serializeHandle', 'deserializeHandle' ] as const).map(function (missing) {
        return test(`requires the ${missing} callback for projected HTTP services`, function (scope: TestScope) {
            const fixture = httpService(null, noFaults);
            const input = {
                ...fixture.input,
                scope: 'per-run',
                serializeHandle() {
                    return 'owner';
                },
                deserializeHandle() {
                    return { baseUrl: 'http://consumer' };
                },
                [missing]: undefined
            };
            scope.assert.throws(function () {
                Reflect.apply(createLocalHttpServiceResource, undefined, [ input ]);
            }, { message: 'Projected local HTTP services require handle projection callbacks.' });
            scope.assert.deepEqual(fixture.lifecycle, []);
            return scope.assert.collect();
        });
    }),

    ...transcriptPolicies.map(function (policy) {
        return test(
            `starts and disposes a ${policy?.kind ?? 'default'} transcript service`,
            async function (scope: TestScope) {
                const fixture = httpService(policy, noFaults);
                const handle = await fixture.service.acquire(fixture.context);
                scope.assert.deepEqual({ baseUrl: handle.baseUrl, entries: handle.transcript.entryCount }, {
                    baseUrl: 'http://127.0.0.1:4321',
                    entries: 0
                });
                scope.require.defined(fixture.service.dispose);
                await fixture.service.dispose(handle, fixture.context);
                await fixture.service.dispose(handle, fixture.context);
                scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
                scope.assert.deepEqual(fixture.lifecycle, [ 'create', 'handle', 'dispose' ]);
                return scope.assert.collect();
            }
        );
    }),
    test('preserves custom transcript evidence', async function (scope: TestScope) {
        const transcript = emptyTranscriptView();
        const fixture = httpService({
            kind: 'custom',
            transcript() {
                return transcript;
            }
        }, noFaults);
        const handle = await fixture.service.acquire(fixture.context);
        scope.assert.equal(handle.transcript, transcript);
        scope.require.defined(fixture.service.dispose);
        await fixture.service.dispose(handle, fixture.context);
        return scope.assert.collect();
    }),
    test('retains custom transcript capture failures as evidence', async function (scope: TestScope) {
        const fixture = httpService({
            kind: 'custom',
            transcript() {
                throw new Error('Capture failed.');
            }
        }, noFaults);
        const handle = await fixture.service.acquire(fixture.context);
        scope.assert.deepEqual<unknown, unknown>(handle.transcript.firstEntry, [ 'capture-error', {
            message: 'Capture failed.',
            source: 'custom'
        } ]);
        scope.require.defined(fixture.service.dispose);
        await fixture.service.dispose(handle, fixture.context);
        return scope.assert.collect();
    }),
    ...[ 'string', 'none' ].map(function (address) {
        return test(`cleans up a server with ${address} address`, async function (scope: TestScope) {
            const fixture = httpService(null, { ...noFaults, address: address === 'string' ? 'string' : 'none' });
            await scope.assert.rejects(async function () {
                await fixture.service.acquire(resourceContext());
            }, { type: Error, message: 'Local HTTP service did not expose a TCP address.' });
            scope.assert.deepEqual(fixture.calls, [ 'listen:127.0.0.1:0', 'close' ]);
            scope.assert.deepEqual(fixture.lifecycle, [ 'create', 'dispose' ]);
            return scope.assert.collect();
        });
    }),
    test('cleans up after listen failure without closing an unbound server', async function (scope: TestScope) {
        const error = new Error('Listen failed.');
        const fixture = httpService(null, { ...noFaults, listen: error });
        let failure: unknown = null;
        try {
            await fixture.service.acquire(resourceContext());
        } catch (error_: unknown) {
            failure = error_;
        }
        scope.assert.equal(failure, error);
        scope.assert.deepEqual({ calls: fixture.calls, lifecycle: fixture.lifecycle }, {
            calls: [ 'listen:127.0.0.1:0' ],
            lifecycle: [ 'create', 'dispose' ]
        });
        scope.assert.equal(fixture.events.listenerCount('listening'), 0);
        return scope.assert.collect();
    }),
    test('reports close failures while disposing the owner', async function (scope: TestScope) {
        const fixture = httpService(null, { ...noFaults, close: new Error('Close failed.') });
        const handle = await fixture.service.acquire(fixture.context);
        scope.require.defined(fixture.service.dispose);
        let failure: unknown = null;
        try {
            await fixture.service.dispose(handle, fixture.context);
        } catch (error_: unknown) {
            failure = error_;
        }
        scope.assert.equal(failure, fixture.faults.close);
        scope.assert.deepEqual(fixture.lifecycle, [ 'create', 'handle', 'dispose' ]);
        return scope.assert.collect();
    })
]);
await runIfMain(import.meta, testNode);
