import type { RunExecutionReply } from '../run/run.entry-point.ts';
import { campaignBaselineSchema, mutationLifecycleDataSchema, type CampaignBaseline } from './mutation-catalog.ts';
import type { CampaignClient } from './campaign-client.ts';

export type MutationBaseline = {
    readonly read: (client: CampaignClient) => Promise<CampaignBaseline | null>;
    readonly publish: (
        client: CampaignClient,
        reply: RunExecutionReply,
        coverageAnalysis: CampaignBaseline['coverageAnalysis'],
        testFiles: readonly string[] | null
    ) => Promise<void>;
};
export function createMutationBaseline(): MutationBaseline {
    const baselines = new Map<'original', CampaignBaseline>();
    return {
        async read(client) {
            const cached = baselines.get('original');
            if (cached !== undefined) {
                return cached;
            }
            const reply = await client.request({ kind: 'fetch' });
            if (reply.kind !== 'baseline') {
                throw new Error('Campaign IPC did not return a dry-run baseline.');
            }
            const baseline = campaignBaselineSchema.nullable().parse(reply.baseline);
            if (baseline !== null) {
                baselines.set('original', baseline);
            }
            return baseline;
        },
        async publish(client, reply, coverageAnalysis, testFiles) {
            const data = mutationLifecycleDataSchema.parse(reply.data);
            const baseline = campaignBaselineSchema.parse({
                catalog: data.catalog,
                coverage: data.coverage,
                coverageAnalysis,
                testFiles
            });
            const response = await client.request({ kind: 'publish', baseline });
            if (response.kind !== 'accepted') {
                throw new Error('Campaign IPC did not acknowledge the dry-run baseline.');
            }
            baselines.set('original', baseline);
        }
    };
}
