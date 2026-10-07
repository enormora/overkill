import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createSuite, createTestCase, type TestScope } from '../packages/engine/engine.entry-point.ts';
import { createLocalHttpServiceResource, startResources } from '../packages/resources/resources.entry-point.ts';
import { observeTranscriptEntries } from '../packages/simulation/transcript.entry-point.ts';
import { runWithTranscriptScope, type TranscriptScope } from '../transcript/transcript-store.ts';
import { createHttpRequestAttribution, type HttpRequestAttribution } from './http-request-attribution.ts';

async function fetchFromExternalProcess(baseUrl: string): Promise<void> {
    await new Promise<void>(function fetchOutsideRunner(resolve, reject) {
        execFile(
            process.execPath,
            [ '-e', 'fetch(process.argv[1]).then(response => response.text());', baseUrl ],
            function fetched(error) {
                if (error === null) {
                    resolve();
                } else {
                    reject(new Error('External HTTP request failed.', { cause: error }));
                }
            }
        );
    });
}
const metadata = { annotations: {}, controls: {}, definitionLocations: [ { kind: 'unknown' } ] } as const;
async function assertUncorrelatedScope(scope: TestScope, lifetime: 'per-case' | 'shared-per-worker'): Promise<void> {
    const controller = new AbortController();
    const acquisition = Object.freeze({ phase: 'acquisition' });
    const resource = createLocalHttpServiceResource({
        name: 'api',
        scope: lifetime,
        requirements: [],
        dependencies: {},
        address: { kind: 'loopback', port: 0 },
        createServer() {
            return createServer(function (_request, response) {
                response.end('ready');
            });
        },
        handle(service) {
            return { baseUrl: service.baseUrl };
        },
        dispose() {
            return undefined;
        }
    });
    const session = await runWithTranscriptScope(acquisition, async function acquireScopedServer() {
        return await startResources({ resources: { api: resource }, signal: controller.signal });
    });
    scope.cleanup(async function disposeServer() {
        await session.disposeOnce({ signal: controller.signal });
    });
    const captured: (TranscriptScope | null)[] = [];
    const stop = observeTranscriptEntries(session.context.api.transcript, function recordScope(_entry, owner) {
        captured.push(owner);
    });
    scope.cleanup(stop);
    await fetchFromExternalProcess(session.context.api.baseUrl);
    scope.assert.deepEqual(captured, [ lifetime === 'per-case' ? acquisition : null ]);
}
function assertAmbiguousRequests(scope: TestScope): void {
    const requests = createHttpRequestAttribution();
    requests.remember('GET /', { case: 'first' }, { client: 'first' });
    requests.remember('GET /', { case: 'second' }, { client: 'second' });
    const first = requests.take('GET /');
    const second = requests.take('GET /');
    scope.require.defined(first);
    scope.require.defined(second);
    scope.assert.deepEqual(first, { scope: null, undiciRequest: null });
    scope.assert.deepEqual(second, { scope: null, undiciRequest: null });
    scope.assert.equal(requests.take('GET /'), null);
}
function assertRequestIdentity(
    scope: TestScope,
    requests: HttpRequestAttribution,
    owner: TranscriptScope,
    client: Readonly<Record<string, unknown>>
): void {
    const request = requests.take('GET /');
    scope.require.defined(request);
    scope.assert.deepEqual(request, { scope: owner, undiciRequest: client });
}
function assertSameScopeRequests(scope: TestScope): void {
    const requests = createHttpRequestAttribution();
    const owner = { case: 'same attempt' };
    const first = { client: 'first' };
    const second = { client: 'second' };
    requests.remember('GET /', owner, first);
    requests.remember('GET /', owner, second);
    assertRequestIdentity(scope, requests, owner, first);
    assertRequestIdentity(scope, requests, owner, second);
    scope.assert.equal(requests.take('GET /'), null);
}
export const testNode = createSuite({
    ...metadata,
    title: 'source/resources/local-http-failure-attribution.test.ts',
    children: [
        createTestCase({
            ...metadata,
            title: 'identical overlapping requests in one attempt preserve their client identities',
            body(scope: TestScope) {
                assertSameScopeRequests(scope);
                return scope.assert.collect();
            }
        }),
        createTestCase({
            ...metadata,
            title: 'overlapping request signatures never borrow another case scope',
            body(scope: TestScope) {
                assertAmbiguousRequests(scope);
                return scope.assert.collect();
            }
        }),
        ...[ 'per-case', 'shared-per-worker' ].map(function scopedRequest(lifetime) {
            return createTestCase({
                ...metadata,
                title: `unmatched ${lifetime} requests keep their resource lifetime attribution`,
                async body(scope: TestScope) {
                    await assertUncorrelatedScope(scope, lifetime === 'per-case' ? 'per-case' : 'shared-per-worker');
                    return scope.assert.collect();
                }
            });
        })
    ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
