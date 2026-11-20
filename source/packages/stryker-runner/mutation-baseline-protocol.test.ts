import { table, type TestNode, suite } from '@overkill-dev/test';

import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { createMutationBaseline } from './mutation-baseline.ts';
import type { CampaignClient } from './campaign-client.ts';
import type { CampaignResponse } from './campaign-protocol.ts';

function respondingClient(response: CampaignResponse): CampaignClient {
    return {
        async request() {
            return await Promise.resolve(response);
        },
        async expireRequests() {
            await Promise.resolve();
        },
        dispose() {
            return undefined;
        }
    };
}
export const testNode: TestNode = suite(
    'mutation baseline protocol failures',
    [ table({
        title: 'rejects baseline',
        cases: [ false, true ].flatMap(function (publish) {
            return [ false, true ].map(function (timeout) {
                return { publish, timeout };
            });
        }),
        caseTitle({ publish, timeout }) {
            return [ publish ? 'publication' : 'fetch', timeout ? 'timeout' : 'unexpected acknowledgement' ]
                .map(String)
                .join(', ');
        },
        async test(scope) {
            const { publish, timeout } = scope.parameters;

            const baseline = createMutationBaseline();
            const unexpected: CampaignResponse = publish
                ? { kind: 'baseline', baseline: null }
                : { kind: 'accepted' };
            const client = respondingClient(
                timeout ? { kind: 'timeout', artifacts: [], data: null } : unexpected
            );
            const { reply } = mutationCoverageFixture('off');
            await scope.assert.rejects(async function () {
                if (publish) {
                    await baseline.publish(client, reply, {
                        coverageAnalysis: 'off',
                        testFiles: null,
                        budget: null
                    });
                } else {
                    await baseline.read(client, null);
                }
            }, {
                message: timeout
                    ? 'Invocation deadline exceeded.'
                    : `Campaign IPC did not ${
                        publish ? 'acknowledge the dry-run baseline.' : 'return a dry-run baseline.'
                    }`
            });
            scope.assert.equal(
                await baseline.read(respondingClient({ kind: 'baseline', baseline: null }), null),
                null
            );
            return scope.assert.collect();
        }
    }) ]
);
