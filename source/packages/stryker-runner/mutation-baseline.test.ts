import { realpath } from 'node:fs/promises';
import { z } from 'zod/v4';
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
    readonly signal: AbortSignal;
};
async function expireNoRequests(): Promise<void> {
    await Promise.resolve();
}

async function registeredCampaign(scope: TestScope): Promise<RegisteredCampaign> {
    const baselines = new Map<string, CampaignBaseline>();
    const campaigns = new Map<string, string>();
    const worker = createCampaignWorker(baselines, campaigns);
    const replacement = createCampaignWorker(baselines, campaigns);
    const root = await realpath(process.cwd());
    scope.cleanup(async function disposeCampaignWorkers() {
        await Promise.all([ worker.dispose(), replacement.dispose() ]);
    });
    const { signal } = new AbortController();
    await Promise.all([
        worker.respond({ kind: 'register', root }, signal, null),
        replacement.respond({ kind: 'register', root }, signal, null)
    ]);
    return {
        replacement,
        signal,
        client: {
            expireRequests: expireNoRequests,
            async request(request) {
                return await worker.respond(campaignRequestSchema.shape.request.parse(request), signal, null);
            },
            dispose() {
                return undefined;
            }
        }
    };
}

export const testNode = suite('mutation baseline evidence', [
    test('shares campaign identity across workers while separating canonical roots', async function (scope) {
        const baselines = new Map<string, CampaignBaseline>();
        const campaigns = new Map<string, string>();
        const workers = [ process.cwd(), process.cwd(), import.meta.dirname ].map(function campaignWorker(root) {
            return { root, worker: createCampaignWorker(baselines, campaigns) };
        });
        scope.cleanup(async function disposeWorkers() {
            await Promise.all(workers.map(async function disposeWorker(entry) {
                await entry.worker.dispose();
            }));
        });
        const controller = new AbortController();
        const identities = await Promise.all(workers.map(async function registerWorker(entry) {
            const response = await entry.worker.respond(
                { kind: 'register', root: entry.root },
                controller.signal,
                null
            );
            return z.object({ kind: z.literal('registered'), campaign: z.uuid() }).parse(response).campaign;
        }));
        scope.assert.equal(identities[0], identities[1]);
        scope.assert.notEqual(identities[0], identities[2]);
        return scope.assert.collect();
    }),
    test('retains initially empty eligible files across worker replacement', async function (scope) {
        const { reply, baseline } = mutationCoverageFixture('perTest');
        const { client, replacement, signal } = await registeredCampaign(scope);
        const original = createMutationBaseline();
        scope.assert.equal(await original.read(client, null), null);
        const files = [ 'empty.test.ts', 'first.test.ts', 'second.test.ts', 'unrelated.test.ts' ];
        await original.publish(client, reply, { coverageAnalysis: 'perTest', testFiles: files, budget: null });
        scope.assert.deepEqual(await replacement.respond({ kind: 'fetch' }, signal, null), {
            kind: 'baseline',
            baseline: { ...baseline, testFiles: files }
        });
        return scope.assert.collect();
    }),
    ...([ 'all', 'off', 'perTest' ] as const).map(function coverageMode(mode) {
        return test(`${mode} retains raw counters and mode across replacement workers`, async function (scope) {
            const { baseline, reply } = mutationCoverageFixture(mode);
            const { client, replacement, signal } = await registeredCampaign(scope);
            await createMutationBaseline().publish(client, reply, {
                coverageAnalysis: mode,
                testFiles: null,
                budget: null
            });
            scope.assert.deepEqual(await replacement.respond({ kind: 'fetch' }, signal, null), {
                kind: 'baseline',
                baseline
            });
            const fetched = await createMutationBaseline().read(client, null);
            if (fetched === null) {
                throw new Error('Missing published campaign baseline.');
            }
            scope.assert.deepEqual(fetched, baseline);
            await scope.assert.rejects(async function conflictingMode() {
                await createMutationBaseline().publish(client, reply, {
                    coverageAnalysis: mode === 'off' ? 'perTest' : 'off',
                    testFiles: null,
                    budget: null
                });
            }, { message: 'Conflicting campaign baseline publication.' });
            return scope.assert.collect();
        });
    }),
    test('does not recover missing baselines from an empty counter object', async function (scope) {
        const { client } = await registeredCampaign(scope);
        scope.assert.equal(await createMutationBaseline().read(client, null), null);
        return scope.assert.collect();
    }),
    test('propagates disconnected transport without inventing a baseline', async function (scope) {
        const client: CampaignClient = {
            expireRequests: expireNoRequests,
            async request() {
                throw new Error('Campaign IPC disconnected.');
            },
            dispose() {
                return undefined;
            }
        };
        await scope.assert.rejects(async function fetchDisconnectedBaseline() {
            await createMutationBaseline().read(client, null);
        }, { message: 'Campaign IPC disconnected.' });
        return scope.assert.collect();
    }),
    test('requires publication acknowledgement before retaining the dry-run baseline', async function (scope) {
        const { reply } = mutationCoverageFixture('perTest');
        const client: CampaignClient = {
            expireRequests: expireNoRequests,
            async request() {
                return { artifacts: [], kind: 'timeout', data: null };
            },
            dispose() {
                return undefined;
            }
        };
        await scope.assert.rejects(async function publishWithoutAcknowledgement() {
            await createMutationBaseline().publish(client, reply, {
                coverageAnalysis: 'perTest',
                testFiles: null,
                budget: null
            });
        }, { message: 'Invocation deadline exceeded.' });
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
