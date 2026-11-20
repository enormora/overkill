import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { table, type TestNode, suite, test, type TestScope } from '@overkill-dev/test';

import { createLocalHttpServiceResource, startResources } from '../../../packages/resources/resources.entry-point.ts';
import { observeTranscriptEntries } from '../../../packages/simulation/transcript.entry-point.ts';
import { runWithTranscriptScope, type TranscriptScope } from '../../../transcript/transcript-store.ts';
import {
    createHttpRequestAttribution,
    type HttpRequestAttribution
} from '../../../resources/http-request-attribution.ts';

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
export const testNode: TestNode = suite('Local HTTP failure attribution', [
    test('identical overlapping requests in one attempt preserve their client identities', function (scope) {
        assertSameScopeRequests(scope);
        return scope.assert.collect();
    }),
    test('overlapping request signatures never borrow another case scope', function (scope) {
        assertAmbiguousRequests(scope);
        return scope.assert.collect();
    }),
    table({
        title: 'unmatched requests keep their resource lifetime attribution',
        cases: [ 'per-case', 'shared-per-worker' ],
        caseTitle(lifetime) {
            return lifetime;
        },
        async test(scope) {
            const lifetime = scope.parameters;

            await assertUncorrelatedScope(scope, lifetime === 'per-case' ? 'per-case' : 'shared-per-worker');
            return scope.assert.collect();
        }
    })
]);
