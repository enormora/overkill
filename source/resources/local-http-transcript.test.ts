import { createServer, request as createRequest } from 'node:http';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import {
    httpTranscriptBodyByteLimit,
    type HttpTranscript,
    type HttpTranscriptEntry
} from '../transcript/http-transcript.ts';
import {
    createLocalHttpServiceResource,
    type LocalHttpResourceHandle,
    type LocalHttpServiceHandle,
    type LocalHttpTranscriptPolicy
} from './local-http-service-resource.ts';
import { startResources } from './resource-session.ts';
import type { EmptyResourceDependencies, ResourceDefinition } from './resources.ts';

type LocalHttpTestResource = ResourceDefinition<
    'app',
    LocalHttpResourceHandle<LocalHttpServiceHandle>,
    EmptyResourceDependencies
>;
type DisabledTranscriptPolicy = { readonly kind: 'disabled'; };
type TestTranscriptPolicy = LocalHttpTranscriptPolicy<null>;

const testController = new AbortController();
const testSignal = testController.signal;
const textEncoder = new TextEncoder();

function localHttpResource(...policy: readonly [] | readonly [TestTranscriptPolicy]): LocalHttpTestResource {
    const input = {
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
        handle(handle: LocalHttpServiceHandle) {
            return handle;
        },
        dispose() {
            return undefined;
        }
    } as const;

    return policy.length === 0
        ? createLocalHttpServiceResource(input)
        : createLocalHttpServiceResource(input, policy[0]);
}

async function requestWithNodeHttp(url: string, body: string): Promise<void> {
    await new Promise<void>(function sendRequest(resolve, reject) {
        const request = createRequest(url, { method: 'POST' }, function receiveResponse(response) {
            response.resume();
            response.on('end', resolve);
        });

        request.on('error', reject);
        request.end(body);
    });
}

function assertBoundedExternalEntry(scope: TestScope, entry: HttpTranscriptEntry<unknown>, body: string): void {
    scope.assert.deepEqual(entry[1].request.body, {
        bytes: textEncoder.encode(body.slice(0, httpTranscriptBodyByteLimit)),
        kind: 'truncated',
        originalByteLength: body.length
    });
    scope.assert.equal(entry[1].outcome.kind, 'response');
    if (entry[1].outcome.kind === 'response') {
        scope.assert.deepEqual(entry[1].outcome.response.body, {
            kind: 'unavailable',
            reason: 'transport-does-not-expose-body'
        });
    }
}

async function assertExternalRequest(scope: TestScope): Promise<void> {
    const session = await startResources({ resources: { app: localHttpResource() }, signal: testSignal });
    const body = 'x'.repeat(httpTranscriptBodyByteLimit + 1);

    await requestWithNodeHttp(session.context.app.baseUrl, body);
    const entry = session.context.app.transcript.firstEntry;

    scope.require.defined(entry);
    scope.assert.equal(entry[0], 'http');
    if (entry[0] === 'http') {
        assertBoundedExternalEntry(scope, entry, body);
    }

    await session.disposeOnce({ signal: testSignal });
}

async function transcriptEntryCount(policy: DisabledTranscriptPolicy): Promise<number> {
    const session = await startResources({ resources: { app: localHttpResource(policy) }, signal: testSignal });

    await fetch(session.context.app.baseUrl);
    const { entryCount } = session.context.app.transcript;

    await session.disposeOnce({ signal: testSignal });

    return entryCount;
}

async function captureFailureEntries(): Promise<HttpTranscript<unknown>['entries']> {
    const session = await startResources({
        resources: {
            app: localHttpResource({
                kind: 'custom',
                transcript() {
                    throw new Error('capture failed');
                }
            })
        },
        signal: testSignal
    });

    await fetch(session.context.app.baseUrl);
    const { entries } = session.context.app.transcript;

    await session.disposeOnce({ signal: testSignal });

    return entries;
}

async function assertTranscriptPolicies(scope: TestScope): Promise<void> {
    scope.assert.equal(await transcriptEntryCount({ kind: 'disabled' }), 0);
    scope.assert.deepEqual(await captureFailureEntries(), [
        [ 'capture-error', { message: 'capture failed', source: 'custom' } ]
    ]);
}

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/resources/local-http-transcript.test.ts',
    annotations: {},
    controls: {},
    children: [
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP resources record external request metadata and bounded bodies',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertExternalRequest(scope);

                return scope.assert.collect();
            }
        }),
        createTestCase({
            definitionLocations: [ { kind: 'unknown' } ],
            title: 'local HTTP resources support transcript policies',
            annotations: {},
            controls: {},
            async body(scope: TestScope) {
                await assertTranscriptPolicies(scope);

                return scope.assert.collect();
            }
        })
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
