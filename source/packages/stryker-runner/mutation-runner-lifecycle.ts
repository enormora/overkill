import type { FileDescriptions } from '@stryker-mutator/api/core';
import type { Logger } from '@stryker-mutator/api/logging';
import { ConfigError, restoreRunExecutionFailure } from '../run/run.entry-point.ts';
import { defaultCampaignEndpoint } from './runner-options.ts';
import { parseRunnerOptions, type OverkillRunnerOptions } from './runner-settings-schema.ts';
import { assertExcludedAdapter, createMutationSandbox, type MutationSandbox } from './mutation-sandbox.ts';
import { connectCampaign, type CampaignClient } from './campaign-client.ts';
import { campaignEndpointSchema } from './campaign-protocol.ts';
import { createMutationRunnerExecution, type MutationRunnerExecution } from './mutation-runner-execution.ts';

const originalRoot = process.cwd();
export type ReadyMutationRunner = {
    readonly execution: MutationRunnerExecution;
    readonly client: CampaignClient;
    readonly root: string;
};
type RunnerInitialization = {
    readonly options: Readonly<Record<string, unknown>>;
    readonly files: FileDescriptions;
    readonly logger: Readonly<Pick<Logger, 'info'>>;
    readonly signal: AbortSignal;
    readonly connected: (client: CampaignClient) => void;
};
export type MutationRunnerLifecycle = {
    readonly ready: () => Promise<ReadyMutationRunner>;
    readonly invoke: <Value extends { readonly status: string; }>(
        timeout: number,
        run: (runner: ReadyMutationRunner, remaining: number) => Promise<Value>,
        expired: () => Value
    ) => Promise<Value>;
    readonly dispose: () => Promise<void>;
};

type MutationInvocation<Value> = {
    readonly timeout: number;
    readonly started: number;
    readonly run: (runner: ReadyMutationRunner, remaining: number) => Promise<Value>;
    readonly expired: () => Value;
};

type RegisteredRunnerInitialization = {
    readonly sandbox: MutationSandbox;
    readonly settings: OverkillRunnerOptions;
    readonly client: CampaignClient;
    readonly signal: AbortSignal;
};
async function initializeRegisteredRunner(input: RegisteredRunnerInitialization): Promise<ReadyMutationRunner> {
    const { sandbox, settings, client, signal } = input;
    await client.request({ kind: 'register', root: sandbox.root });
    const response = await client.request({ kind: 'resolve-policy', sandbox, settings });
    if (response.kind === 'failure') {
        throw restoreRunExecutionFailure(response.failure);
    }
    if (response.kind !== 'policy') {
        throw new Error('Campaign IPC did not return a frozen execution policy.');
    }
    const execution = createMutationRunnerExecution({
        policy: response.policy,
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

async function initializeRunner(input: RunnerInitialization): Promise<ReadyMutationRunner> {
    const settings = parseRunnerOptions(input.options.overkill);
    input.logger.info('Overkill campaign seed: %s', settings.seed);
    const sandbox = await createMutationSandbox({ originalRoot, cwd: process.cwd(), fileDescriptions: input.files });
    await assertExcludedAdapter(sandbox);
    const client = await connectRegisteredCampaign(input);
    try {
        return await initializeRegisteredRunner({ sandbox, settings, client, signal: input.signal });
    } catch (error: unknown) {
        client.dispose();
        throw error;
    }
}

async function disposeRunner(initialization: Promise<ReadyMutationRunner> | null): Promise<void> {
    const settled = await Promise.allSettled(initialization === null ? [] : [ initialization ]);
    const initialized = settled[0];
    if (initialized?.status === 'fulfilled') {
        try {
            await initialized.value.execution.dispose();
        } finally {
            initialized.value.client.dispose();
        }
    }
}

async function runBeforeDeadline<Value extends { readonly status: string; }>(
    runner: ReadyMutationRunner,
    invocation: MutationInvocation<Value>
): Promise<Value> {
    const { timeout, started, run, expired } = invocation;
    const remaining = timeout - (performance.now() - started);
    if (remaining <= 0) {
        return expired();
    }
    const result = await run(runner, remaining);
    return result.status !== 'error' && performance.now() - started >= timeout ? expired() : result;
}

export function createMutationRunnerLifecycle(
    options: RunnerInitialization['options'],
    files: FileDescriptions,
    logger: RunnerInitialization['logger']
): MutationRunnerLifecycle {
    const controller = new AbortController();
    let initialization: Promise<ReadyMutationRunner> | null = null;
    const ownership = {
        active: new Set<symbol>(),
        disposed: new Set<'runner'>(),
        clients: new Map<'connected', CampaignClient>(),
        closing: new Map<'shutdown', Promise<void>>()
    };
    async function ready(): Promise<ReadyMutationRunner> {
        if (ownership.disposed.has('runner')) {
            throw new ConfigError('Stryker runner has been disposed.');
        }
        const initializing = initialization ??
            initializeRunner({
                options,
                files,
                logger,
                signal: controller.signal,
                connected(client) {
                    ownership.clients.set('connected', client);
                }
            });
        initialization = initializing;
        return await initializing;
    }
    async function closeRunner(): Promise<void> {
        ownership.disposed.add('runner');
        const client = ownership.clients.get('connected');
        if (client === undefined) {
            controller.abort();
        }
        if (client !== undefined) {
            await Promise.allSettled([ client.request({ kind: 'release' }) ]);
        }
        controller.abort();
        await disposeRunner(initialization);
    }
    return {
        ready,
        async invoke(timeout, run, expired) {
            if (ownership.active.size > 0) {
                throw new Error('A Stryker invocation is already running.');
            }
            const started = performance.now();
            const invocation = Symbol('mutation-invocation');
            ownership.active.add(invocation);
            try {
                return await runBeforeDeadline(await ready(), { timeout, started, run, expired });
            } finally {
                ownership.active.delete(invocation);
            }
        },
        async dispose() {
            const closing = ownership.closing.get('shutdown') ?? closeRunner();
            ownership.closing.set('shutdown', closing);
            await closing;
        }
    };
}
