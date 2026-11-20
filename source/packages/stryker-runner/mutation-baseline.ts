import {
    InvocationDeadlineExceededError,
    type InvocationBudget
} from '../run/run.entry-point.ts';
import { createStoredValue } from '../../stored-value.ts';
import { campaignBaselineSchema, type CampaignBaseline } from './mutation-catalog.ts';
import type { CampaignClient } from './campaign-client.ts';

export type MutationBaseline = {
    readonly read: (client: CampaignClient, budget: InvocationBudget | null) => Promise<CampaignBaseline | null>;
    readonly publish: (
        client: CampaignClient,
        baseline: CampaignBaseline,
        budget: InvocationBudget | null
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
    return reply.baseline;
}
export function createMutationBaseline(): MutationBaseline {
    const original = createStoredValue<CampaignBaseline | null>(null);
    return {
        async read(client, budget) {
            const baseline = original.read() ?? await fetchBaseline(client, budget);
            const retained = original.read() ?? baseline;
            original.write(retained);
            return retained;
        },
        async publish(client, baseline, budget) {
            const validated = campaignBaselineSchema.parse(baseline);
            const response = await client.request({ kind: 'publish', baseline: validated }, budget);
            if (response.kind === 'timeout') {
                throw new InvocationDeadlineExceededError();
            }
            if (response.kind !== 'accepted') {
                throw new Error('Campaign IPC did not acknowledge the dry-run baseline.');
            }
            original.write(validated);
        }
    };
}
