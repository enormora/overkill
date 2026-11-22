import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { defineCompositeAssertion } from '@overkill-dev/test/assert';
import { table, suite, test, type TestScope } from '@overkill-dev/test';

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

const assertRequestIdentity = defineCompositeAssertion({
    name: 'request identity',
    assert(check, requests: HttpRequestAttribution, owner: TranscriptScope, client: Readonly<Record<string, unknown>>) {
        const request = requests.take('GET /');
        if (request === null) {
            return check.defined(request);
        }
        return check.group([
            check.defined(request),
            check.deepEqual(request, { scope: owner, undiciRequest: client })
        ]);
    }
});

export const testNode = suite('Local HTTP failure attribution', [
    test('identical overlapping requests in one attempt preserve their client identities', function (scope) {
        const requests = createHttpRequestAttribution();
        const owner = { case: 'same attempt' };
        const first = { client: 'first' };
        const second = { client: 'second' };
        requests.remember('GET /', owner, first);
        requests.remember('GET /', owner, second);
        scope.assert(assertRequestIdentity, requests, owner, first);
        scope.assert(assertRequestIdentity, requests, owner, second);
        scope.assert.equal(requests.take('GET /'), null);

        return scope.assert.collect();
    }),
    test('overlapping request signatures never borrow another case scope', function (scope: TestScope) {
        const requests = createHttpRequestAttribution();
        requests.remember('GET /', { case: 'first' }, { client: 'first' });
        requests.remember('GET /', { case: 'second' }, { client: 'second' });
        const first = requests.take('GET /');
        const second = requests.take('GET /');
        scope.require.defined(first);
        scope.require.defined(second);
        scope.assert(
            defineCompositeAssertion({
                name: 'overlapping request signatures never borrow another case scope',
                assert(check) {
                    return check.group([
                        check.deepEqual(first, { scope: null, undiciRequest: null }),
                        check.deepEqual(second, { scope: null, undiciRequest: null })
                    ]);
                }
            })
        );
        scope.assert.equal(requests.take('GET /'), null);

        return scope.assert.collect();
    }),
    table({
        title: 'unmatched requests keep their resource lifetime attribution',
        cases: [ 'per-case', 'shared-per-worker' ] as const,
        caseTitle(lifetime) {
            return lifetime;
        },
        async test({ assert, cleanup, parameters: lifetime }) {
            const uncorrelatedScopeController = new AbortController();
            const uncorrelatedScopeAcquisition = Object.freeze({ phase: 'acquisition' });
            const uncorrelatedScopeResource = createLocalHttpServiceResource({
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
            const uncorrelatedScopeSession = await runWithTranscriptScope(
                uncorrelatedScopeAcquisition,
                async function acquireScopedServer() {
                    return await startResources({
                        resources: { api: uncorrelatedScopeResource },
                        signal: uncorrelatedScopeController.signal
                    });
                }
            );
            cleanup(async function disposeServer() {
                await uncorrelatedScopeSession.disposeOnce({ signal: uncorrelatedScopeController.signal });
            });
            const uncorrelatedScopeCaptured: (TranscriptScope | null)[] = [];
            cleanup(observeTranscriptEntries(
                uncorrelatedScopeSession.context.api.transcript,
                function recordScope(_entry, owner) {
                    uncorrelatedScopeCaptured.push(owner);
                }
            ));
            await fetchFromExternalProcess(uncorrelatedScopeSession.context.api.baseUrl);
            assert.deepEqual(uncorrelatedScopeCaptured, [
                lifetime === 'per-case' ? uncorrelatedScopeAcquisition : null
            ]);

            return assert.collect();
        }
    })
]);
