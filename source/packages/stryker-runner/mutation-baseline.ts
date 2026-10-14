import type { RunExecutionReply } from '../run/run.entry-point.ts';
import { campaignBaselineSchema, mutationLifecycleDataSchema, type CampaignBaseline } from './mutation-catalog.ts';
import type { CampaignClient } from './campaign-client.ts';

export type MutationBaseline = {
    readonly fetch: (client: CampaignClient) => Promise<CampaignBaseline>;
    readonly publish: (client: CampaignClient, reply: RunExecutionReply) => Promise<void>;
};
export function createMutationBaseline(): MutationBaseline {
    const baselines = new Map<'original', CampaignBaseline>();
    return {
        async fetch(client) {
            const cached = baselines.get('original');
            if (cached !== undefined) {
                return cached;
            }
            const reply = await client.request({ kind: 'fetch' });
            if (reply.kind !== 'baseline') {
                throw new Error('Campaign IPC did not return a dry-run baseline.');
            }
            const baseline = campaignBaselineSchema.parse(reply.baseline);
            baselines.set('original', baseline);
            return baseline;
        },
        async publish(client, reply) {
            const data = mutationLifecycleDataSchema.parse(reply.data);
            const baseline = { catalog: data.catalog, coverage: data.coverage };
            await client.request({ kind: 'publish', baseline });
            baselines.set('original', baseline);
        }
    };
}
