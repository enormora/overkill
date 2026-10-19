import {
    type RunExecutionReply,
    InvocationDeadlineExceededError,
    type InvocationBudget
} from '../run/run.entry-point.ts';
import { campaignBaselineSchema, mutationLifecycleDataSchema, type CampaignBaseline } from './mutation-catalog.ts';
import type { CampaignClient } from './campaign-client.ts';

type MutationBaselinePublication = {
    readonly coverageAnalysis: CampaignBaseline['coverageAnalysis'];
    readonly testFiles: readonly string[] | null;
    readonly budget: InvocationBudget | null;
};

export type MutationBaseline = {
    readonly read: (client: CampaignClient, budget: InvocationBudget | null) => Promise<CampaignBaseline | null>;
    readonly publish: (
        client: CampaignClient,
        reply: RunExecutionReply,
        publication: MutationBaselinePublication
    ) => Promise<void>;
};
async function fetchBaseline(
    client: CampaignClient,
    budget: InvocationBudget | null
): Promise<CampaignBaseline | null> {
    const reply = await client.request({ kind: 'fetch' }, budget);
    if (reply.kind === 'timeout') {
        throw new InvocationDeadlineExceededError();
    }
    if (reply.kind !== 'baseline') {
        throw new Error('Campaign IPC did not return a dry-run baseline.');
    }
    return campaignBaselineSchema.nullable().parse(reply.baseline);
}
export function createMutationBaseline(): MutationBaseline {
    const baselines = new Map<'original', CampaignBaseline>();
    return {
        async read(client, budget) {
            const cached = baselines.get('original');
            if (cached !== undefined) {
                return cached;
            }
            const baseline = await fetchBaseline(client, budget);
            if (baseline !== null) {
                baselines.set('original', baseline);
            }
            return baseline;
        },
        async publish(client, reply, publication) {
            const { coverageAnalysis, testFiles, budget } = publication;
            const data = mutationLifecycleDataSchema.parse(reply.data);
            const baseline = campaignBaselineSchema.parse({
                catalog: data.catalog,
                coverage: data.coverage,
                coverageAnalysis,
                testFiles
            });
            const response = await client.request({ kind: 'publish', baseline }, budget);
            if (response.kind === 'timeout') {
                throw new InvocationDeadlineExceededError();
            }
            if (response.kind !== 'accepted') {
                throw new Error('Campaign IPC did not acknowledge the dry-run baseline.');
            }
            baselines.set('original', baseline);
        }
    };
}
