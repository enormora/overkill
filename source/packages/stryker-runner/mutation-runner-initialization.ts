import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import {
    InvocationDeadlineExceededError,
    type InvocationBudget,
    restoreRunExecutionFailure,
    type FrozenMicrotestPolicy
} from '../run/run.entry-point.ts';
import { createMutationDiagnosticContext, type MutationDiagnosticContext } from './mutation-diagnostic-storage.ts';
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
    readonly diagnostics: MutationDiagnosticContext;
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

async function initializeRegisteredRunner(
    input: RegisteredRunnerInitialization,
    createExecution: MutationInitializationRuntime['execute']
): Promise<ReadyMutationRunner> {
    const { sandbox, settings, client, signal, budget } = input;
    const registered = await client.request({ kind: 'register', root: sandbox.root }, budget());
    if (registered.kind === 'timeout') {
        throw new InvocationDeadlineExceededError();
    }
    if (registered.kind !== 'registered') {
        throw new Error('Campaign IPC did not return campaign identity.');
    }
    const response = await client.request({ kind: 'resolve-policy', sandbox, settings }, budget());
    const policy = resolvedPolicy(response);
    const execution = createExecution({
        policy,
        seed: settings.seed,
        freshState: settings.freshState,
        client,
        signal
    });
    return {
        execution,
        client,
        root: sandbox.root,
        diagnostics: createMutationDiagnosticContext({
            originalRoot: sandbox.originalRoot,
            root: sandbox.root,
            settings,
            policy,
            campaign: registered.campaign
        })
    };
}
async function connectRegisteredCampaign(
    input: RunnerInitialization,
    connect: MutationInitializationRuntime['connect']
): Promise<CampaignClient> {
    const endpoint = campaignEndpointSchema.parse(input.options.overkillCampaign ?? defaultCampaignEndpoint);
    const client = await connect(endpoint, input.signal);
    input.connected(client);
    return client;
}

export type MutationInitializationRuntime = {
    readonly sandbox: typeof createMutationSandbox;
    readonly exclude: typeof assertExcludedAdapter;
    readonly connect: typeof connectCampaign;
    readonly execute: typeof createMutationRunnerExecution;
};
export async function initializeCampaignRunner(
    input: RunnerInitialization,
    runtime: MutationInitializationRuntime
): Promise<ReadyMutationRunner> {
    const settings = parseRunnerOptions(input.options.overkill);
    input.logger.info('Overkill campaign seed: %s', settings.seed);
    const sandbox = await runtime.sandbox({ originalRoot, cwd: process.cwd(), fileDescriptions: input.files });
    await runtime.exclude(sandbox);
    const client = await connectRegisteredCampaign(input, runtime.connect);
    try {
        return await initializeRegisteredRunner({
            sandbox,
            settings,
            client,
            signal: input.signal,
            budget: input.budget
        }, runtime.execute);
    } catch (error: unknown) {
        client.dispose();
        throw error;
    }
}

export async function initializeMutationRunner(input: RunnerInitialization): Promise<ReadyMutationRunner> {
    return await initializeCampaignRunner(input, {
        sandbox: createMutationSandbox,
        exclude: assertExcludedAdapter,
        connect: connectCampaign,
        execute: createMutationRunnerExecution
    });
}
