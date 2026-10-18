import { realpath } from 'node:fs/promises';
import type { TestScope } from '../engine/engine.entry-point.ts';
import { suite, test } from '../test/test.entry-point.ts';
import { mutationCoverageFixture } from '../../test-support/mutation-coverage-fixture.ts';
import { createMutationBaseline } from './mutation-baseline.ts';
import { createCampaignWorker, type CampaignWorker } from './campaign-worker.ts';
import { campaignRequestSchema, campaignResponseSchema } from './campaign-protocol.ts';
import { campaignBaselineSchema, type CampaignBaseline } from './mutation-catalog.ts';
import type { CampaignClient } from './campaign-client.ts';

type RegisteredCampaign = {
    readonly client: CampaignClient;
    readonly replacement: CampaignWorker;
};

async function registeredCampaign(scope: TestScope): Promise<RegisteredCampaign> {
    const baselines = new Map<string, CampaignBaseline>();
    const worker = createCampaignWorker(baselines);
    const replacement = createCampaignWorker(baselines);
    const root = await realpath(process.cwd());
    scope.cleanup(async function disposeCampaignWorkers() {
        await Promise.all([ worker.dispose(), replacement.dispose() ]);
    });
    await Promise.all([ worker.respond({ kind: 'register', root }), replacement.respond({ kind: 'register', root }) ]);
    return {
        replacement,
        client: {
            async request(request) {
                return await worker.respond(campaignRequestSchema.shape.request.parse(request));
            },
            dispose() {
                return undefined;
            }
        }
    };
}

export const testNode = suite('mutation baseline evidence', [
    test('retains initially empty eligible files across worker replacement', async function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const { client, replacement } = await registeredCampaign(scope);
        const original = createMutationBaseline();
        scope.assert.equal(await original.read(client), null);
        const files = [ 'empty.test.ts', 'first.test.ts', 'second.test.ts', 'unrelated.test.ts' ];
        await original.publish(client, reply, 'perTest', files);
        scope.assert.deepEqual(await replacement.respond({ kind: 'fetch' }), {
            kind: 'baseline',
            baseline: { ...baseline, testFiles: files }
        });
        return scope.assert.collect();
    }),
    ...([ 'all', 'off', 'perTest' ] as const).map(function coverageMode(mode) {
        return test(`${mode} retains raw counters and mode across replacement workers`, async function (scope) {
            const { baseline, reply } = mutationCoverageFixture(mode);
            const { client, replacement } = await registeredCampaign(scope);
            await createMutationBaseline().publish(client, reply, mode, null);
            scope.assert.deepEqual(await replacement.respond({ kind: 'fetch' }), { kind: 'baseline', baseline });
            const fetched = await createMutationBaseline().read(client);
            if (fetched === null) {
                throw new Error('Missing published campaign baseline.');
            }
            scope.assert.deepEqual(fetched, baseline);
            await scope.assert.rejects(async function conflictingMode() {
                await createMutationBaseline().publish(client, reply, mode === 'off' ? 'perTest' : 'off', null);
            }, { message: 'Conflicting campaign baseline publication.' });
            return scope.assert.collect();
        });
    }),
    test('does not recover missing baselines from an empty counter object', async function (scope) {
        const { client } = await registeredCampaign(scope);
        scope.assert.equal(await createMutationBaseline().read(client), null);
        return scope.assert.collect();
    }),
    test('propagates disconnected transport without inventing a baseline', async function (scope) {
        const client: CampaignClient = {
            async request() {
                throw new Error('Campaign IPC disconnected.');
            },
            dispose() {
                return undefined;
            }
        };
        await scope.assert.rejects(async function fetchDisconnectedBaseline() {
            await createMutationBaseline().read(client);
        }, { message: 'Campaign IPC disconnected.' });
        return scope.assert.collect();
    }),
    test('requires publication acknowledgement before retaining the dry-run baseline', async function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const client: CampaignClient = {
            async request() {
                return { kind: 'timeout', data: null };
            },
            dispose() {
                return undefined;
            }
        };
        await scope.assert.rejects(async function publishWithoutAcknowledgement() {
            await createMutationBaseline().publish(client, reply, 'perTest', null);
        }, { message: 'Campaign IPC did not acknowledge the dry-run baseline.' });
        return scope.assert.collect();
    }),
    test('rejects incompatible campaign frames and baselines missing their evidence', function (scope) {
        const { baseline } = mutationCoverageFixture('perTest');
        const missingMode = { ...baseline };
        const missingCounters = { ...baseline };
        Reflect.deleteProperty(missingMode, 'coverageAnalysis');
        Reflect.deleteProperty(missingCounters, 'coverage');
        for (
            const value of [ missingMode, missingCounters, { ...baseline, catalog: [] }, {
                ...baseline,
                catalog: [ ...baseline.catalog, ...baseline.catalog ]
            }, {
                ...baseline,
                coverage: { static: {}, perTest: { unknown: { mutant: 1 } } }
            } ]
        ) {
            scope.assert.equal(campaignBaselineSchema.safeParse(value).success, false);
        }
        scope.assert.equal(
            campaignRequestSchema
                .safeParse({
                    version: 1,
                    id: 0,
                    token: '00000000-0000-4000-8000-000000000000',
                    request: { kind: 'fetch' }
                })
                .success,
            false
        );
        scope.assert.equal(
            campaignResponseSchema
                .safeParse({
                    version: 1,
                    id: 0,
                    response: { kind: 'baseline', baseline }
                })
                .success,
            false
        );
        return scope.assert.collect();
    })
]);
