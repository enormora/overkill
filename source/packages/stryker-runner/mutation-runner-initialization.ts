import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
    InvocationDeadlineExceededError,
    type InvocationBudget,
    restoreRunExecutionFailure,
    type FrozenMicrotestPolicy
} from '../run/run.entry-point.ts';
import { defaultCampaignEndpoint } from './runner-options.ts';
import { parseRunnerOptions, type OverkillRunnerOptions } from './runner-settings-schema.ts';
import { assertExcludedAdapter, createMutationSandbox, type MutationSandbox } from './mutation-sandbox.ts';
import { connectCampaign, type CampaignClient } from './campaign-client.ts';
import { campaignEndpointSchema, type CampaignResponse } from './campaign-protocol.ts';
import { createMutationRunnerExecution, type MutationRunnerExecution } from './mutation-runner-execution.ts';

const originalRoot = process.cwd();
export type ReadyMutationRunner = {
    readonly execution: MutationRunnerExecution;
    readonly client: CampaignClient;
    readonly root: string;
};
export type RunnerInitialization = {
    readonly options: Readonly<Record<string, unknown>>;
    readonly files: FileDescriptions;
    readonly logger: Readonly<Pick<Logger, 'info'>>;
    readonly signal: AbortSignal;
    readonly budget: () => InvocationBudget | null;
    readonly connected: (client: CampaignClient) => void;
};
type RegisteredRunnerInitialization = {
    readonly sandbox: MutationSandbox;
    readonly settings: OverkillRunnerOptions;
    readonly client: CampaignClient;
    readonly signal: AbortSignal;
    readonly budget: () => InvocationBudget | null;
};
function resolvedPolicy(response: CampaignResponse): FrozenMicrotestPolicy {
    if (response.kind === 'timeout') {
        throw new InvocationDeadlineExceededError();
    }
    if (response.kind === 'failure') {
        throw restoreRunExecutionFailure(response.failure);
    }
    if (response.kind !== 'policy') {
        throw new Error('Campaign IPC did not return a frozen execution policy.');
    }
    return response.policy;
}

async function initializeRegisteredRunner(input: RegisteredRunnerInitialization): Promise<ReadyMutationRunner> {
    const { sandbox, settings, client, signal, budget } = input;
    await client.request({ kind: 'register', root: sandbox.root }, budget());
    const response = await client.request({ kind: 'resolve-policy', sandbox, settings }, budget());
    const policy = resolvedPolicy(response);
    const execution = createMutationRunnerExecution({
        policy,
        seed: settings.seed,
        freshState: settings.freshState,
        client,
        signal
    });
    return { execution, client, root: sandbox.root };
}
async function connectRegisteredCampaign(input: RunnerInitialization): Promise<CampaignClient> {
    const endpoint = campaignEndpointSchema.parse(input.options.overkillCampaign ?? defaultCampaignEndpoint);
    const client = await connectCampaign(endpoint, input.signal);
    input.connected(client);
    return client;
}

export async function initializeMutationRunner(input: RunnerInitialization): Promise<ReadyMutationRunner> {
    const settings = parseRunnerOptions(input.options.overkill);
    input.logger.info('Overkill campaign seed: %s', settings.seed);
    const sandbox = await createMutationSandbox({ originalRoot, cwd: process.cwd(), fileDescriptions: input.files });
    await assertExcludedAdapter(sandbox);
    const client = await connectRegisteredCampaign(input);
    try {
        return await initializeRegisteredRunner({
            sandbox,
            settings,
            client,
            signal: input.signal,
            budget: input.budget
        });
    } catch (error: unknown) {
        client.dispose();
        throw error;
    }
}
