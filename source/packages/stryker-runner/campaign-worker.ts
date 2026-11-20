import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
    InvocationDeadlineExceededError,
    isInvocationCancellation,
    orchestrator,
    runExecutionFailure,
    type RunExecutionSession,
    type FrozenMicrotestPolicy
} from '../run/run.entry-point.ts';
import { createStoredValue } from '../../stored-value.ts';
import { mutationSessionOptions } from './mutation-runner-execution.ts';
import { initializeMutationPolicy } from './mutation-policy-process.ts';
import { parseRunnerOptions } from './runner-settings-schema.ts';
import type { campaignRequestSchema, CampaignResponse } from './campaign-protocol.ts';
import type { CampaignBaseline } from './mutation-catalog.ts';

type WorkerRequest = Readonly<ReturnType<typeof campaignRequestSchema.parse>['request']>;
type SessionRequest = Extract<WorkerRequest, { readonly kind: 'invoke'; }>;
function invocationTimeout(timeoutMilliseconds: number | null): number {
    if (timeoutMilliseconds === null) {
        throw new Error('Campaign execution requires an invocation budget.');
    }
    return timeoutMilliseconds;
}
export type CampaignWorker = {
    readonly respond: (
        request: WorkerRequest,
        signal: AbortSignal,
        timeoutMilliseconds: number | null
    ) => Promise<CampaignResponse>;
    readonly cancel: () => void;
    readonly dispose: () => Promise<void>;
};
type CampaignAuthority = {
    readonly policy: FrozenMicrotestPolicy;
    readonly seed: string;
};

function createOwnedExecution(authority: CampaignAuthority): RunExecutionSession {
    const { policy, seed } = authority;
    return orchestrator.createExecutionSession(mutationSessionOptions(policy, seed, 'fresh-invocation'));
}
function publishBaseline(
    baselines: Readonly<Map<string, CampaignBaseline>>,
    root: string,
    baseline: CampaignBaseline
): CampaignResponse {
    const previous = baselines.get(root);
    if (previous !== undefined && !isDeepStrictEqual(previous, baseline)) {
        throw new Error('Conflicting campaign baseline publication.');
    }
    baselines.set(root, baseline);
    return { kind: 'accepted' };
}
export type CampaignWorkerRuntime = {
    readonly canonicalRoot: (path: string) => Promise<string>;
    readonly identify: () => string;
    readonly policy: typeof initializeMutationPolicy;
    readonly execution: typeof createOwnedExecution;
};
type CampaignState = {
    readonly baselines: Readonly<Map<string, CampaignBaseline>>;
    readonly campaigns: Readonly<Map<string, string>>;
};
export function createCampaignSession(state: CampaignState, runtime: CampaignWorkerRuntime): CampaignWorker {
    const cancellation = new AbortController();
    const connection = {
        registrationStarted: createStoredValue(false),
        sandboxRoot: createStoredValue<string | null>(null),
        authority: createStoredValue<CampaignAuthority | null>(null),
        execution: createStoredValue<RunExecutionSession | null>(null),
        disposal: createStoredValue<Promise<void> | null>(null)
    };

    async function dispose(): Promise<void> {
        cancellation.abort();
        const pending = connection.disposal.read() ?? connection.execution.read()?.dispose() ?? Promise.resolve();
        connection.disposal.write(pending);
        return pending;
    }
    async function register(sandbox: string): Promise<CampaignResponse> {
        if (connection.registrationStarted.read()) {
            throw new Error('Campaign worker is already registered.');
        }
        connection.registrationStarted.write(true);
        const root = await runtime.canonicalRoot(sandbox);
        connection.sandboxRoot.write(root);
        const campaign = state.campaigns.get(root) ?? runtime.identify();
        state.campaigns.set(root, campaign);
        return { kind: 'registered', campaign };
    }
    async function invoke(
        request: SessionRequest,
        signal: AbortSignal,
        timeoutMilliseconds: number
    ): Promise<CampaignResponse> {
        const authority = connection.authority.read();
        if (authority === null) {
            throw new Error('Campaign execution requires a frozen policy.');
        }
        const execution = connection.execution.read() ?? runtime.execution(authority);
        connection.execution.write(execution);
        return await execution.run({
            data: request.data,
            timeoutMilliseconds,
            signal
        });
    }
    async function freezeRegisteredPolicy(
        request: Extract<WorkerRequest, { readonly kind: 'resolve-policy'; }>,
        signal: AbortSignal,
        cwd: string
    ): Promise<CampaignResponse> {
        if (request.sandbox.root !== cwd || connection.authority.read() !== null) {
            throw new Error('Campaign policy registration is invalid.');
        }
        const settings = parseRunnerOptions(request.settings);
        const policy = await runtime.policy({
            cwd,
            sandbox: request.sandbox,
            settings,
            signal
        });
        if (policy.cwd !== cwd) {
            throw new Error('Isolated execution does not belong to the registered sandbox.');
        }
        connection.authority.write({ policy, seed: settings.seed });
        return { kind: 'policy', policy };
    }
    async function resolvePolicy(
        request: Extract<WorkerRequest, { readonly kind: 'resolve-policy'; }>,
        signal: AbortSignal,
        cwd: string
    ): Promise<CampaignResponse> {
        try {
            return await freezeRegisteredPolicy(request, signal, cwd);
        } catch (error: unknown) {
            if (signal.reason instanceof InvocationDeadlineExceededError && isInvocationCancellation(error, signal)) {
                return { kind: 'timeout', artifacts: [], data: null };
            }
            return { kind: 'failure', artifacts: [], failure: runExecutionFailure(error), data: null };
        }
    }
    async function respondRegistered(
        request: Exclude<WorkerRequest, { readonly kind: 'register' | 'release'; }>,
        signal: AbortSignal,
        timeoutMilliseconds: number | null
    ): Promise<CampaignResponse> {
        const sandboxRoot = connection.sandboxRoot.read();
        if (sandboxRoot === null) {
            throw new Error('Campaign worker must register first.');
        }
        if (request.kind === 'resolve-policy') {
            return await resolvePolicy(request, signal, sandboxRoot);
        }
        if (request.kind === 'publish') {
            return publishBaseline(state.baselines, sandboxRoot, request.baseline);
        }
        if (request.kind === 'fetch') {
            return { kind: 'baseline', baseline: state.baselines.get(sandboxRoot) ?? null };
        }
        return await invoke(request, signal, invocationTimeout(timeoutMilliseconds));
    }
    return {
        async respond(request, signal, timeoutMilliseconds) {
            if (request.kind === 'release') {
                await dispose();
                return { kind: 'accepted' };
            }
            const ownedSignal = AbortSignal.any([ cancellation.signal, signal ]);
            ownedSignal.throwIfAborted();
            return request.kind === 'register'
                ? await register(request.root)
                : await respondRegistered(request, ownedSignal, timeoutMilliseconds);
        },
        cancel() {
            cancellation.abort();
        },
        dispose
    };
}

export function createCampaignWorker(
    baselines: Readonly<Map<string, CampaignBaseline>>,
    campaigns: Readonly<Map<string, string>>
): CampaignWorker {
    return createCampaignSession({ baselines, campaigns }, {
        canonicalRoot: realpath,
        identify: randomUUID,
        policy: initializeMutationPolicy,
        execution: createOwnedExecution
    });
}
