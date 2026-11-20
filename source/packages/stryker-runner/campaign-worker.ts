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
function fetchBaseline(baselines: ReadonlyMap<string, CampaignBaseline>, root: string): CampaignResponse {
    const baseline = baselines.get(root);
    return { kind: 'baseline', baseline: baseline ?? null };
}
function registeredRoot(roots: ReadonlyMap<'sandbox', string>): string {
    const sandbox = roots.get('sandbox');
    if (sandbox === undefined) {
        throw new Error('Campaign worker must register first.');
    }
    return sandbox;
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
    const ownership = {
        root: new Map<'sandbox', string>(),
        registering: new Set<'started'>(),
        session: new Map<'active', RunExecutionSession>(),
        authority: new Map<'frozen', CampaignAuthority>()
    };
    async function register(sandbox: string): Promise<CampaignResponse> {
        if (ownership.registering.has('started')) {
            throw new Error('Campaign worker is already registered.');
        }
        ownership.registering.add('started');
        const root = await runtime.canonicalRoot(sandbox);
        ownership.root.set('sandbox', root);
        const campaign = state.campaigns.get(root) ?? runtime.identify();
        state.campaigns.set(root, campaign);
        return { kind: 'registered', campaign };
    }
    async function release(): Promise<CampaignResponse> {
        cancellation.abort();
        const execution = ownership.session.get('active');
        ownership.session.clear();
        await execution?.dispose();
        return { kind: 'accepted' };
    }
    async function invoke(
        request: SessionRequest,
        signal: AbortSignal,
        timeoutMilliseconds: number
    ): Promise<CampaignResponse> {
        const authority = ownership.authority.get('frozen');
        if (authority === undefined) {
            throw new Error('Campaign execution requires a frozen policy.');
        }
        const execution = ownership.session.get('active') ?? runtime.execution(authority);
        ownership.session.set('active', execution);
        return await execution.run({
            data: request.data,
            timeoutMilliseconds,
            signal
        });
    }
    async function freezeRegisteredPolicy(
        request: Extract<WorkerRequest, { readonly kind: 'resolve-policy'; }>,
        signal: AbortSignal
    ): Promise<CampaignResponse> {
        const cwd = registeredRoot(ownership.root);
        if (request.sandbox.root !== cwd || ownership.authority.has('frozen')) {
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
        ownership.authority.set('frozen', { policy, seed: settings.seed });
        return { kind: 'policy', policy };
    }
    async function resolvePolicy(
        request: Extract<WorkerRequest, { readonly kind: 'resolve-policy'; }>,
        signal: AbortSignal
    ): Promise<CampaignResponse> {
        try {
            return await freezeRegisteredPolicy(request, signal);
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
        const sandbox = registeredRoot(ownership.root);
        if (request.kind === 'resolve-policy') {
            return await resolvePolicy(request, signal);
        }
        if (request.kind === 'publish') {
            return publishBaseline(state.baselines, sandbox, request.baseline);
        }
        if (request.kind === 'fetch') {
            return fetchBaseline(state.baselines, sandbox);
        }
        return await invoke(request, signal, invocationTimeout(timeoutMilliseconds));
    }
    return {
        async respond(request, signal, timeoutMilliseconds) {
            if (request.kind === 'release') {
                return await release();
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
        async dispose() {
            cancellation.abort();
            await ownership.session.get('active')?.dispose();
        }
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
