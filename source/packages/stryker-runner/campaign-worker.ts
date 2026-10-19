import { realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
    InvocationDeadlineExceededError,
    isInvocationCancellation,
    normalizeConfig,
    orchestrator,
    runExecutionFailure,
    type RunExecutionSession,
    type FrozenMicrotestPolicy
} from '../run/run.entry-point.ts';
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
function createOwnedExecution(input: Readonly<SessionRequest['session']>): RunExecutionSession {
    const { outputRenderer } = normalizeConfig({});
    return orchestrator.createExecutionSession({
        command: {
            kind: 'frozen-policy',
            policy: input.policy,
            invocation: { seed: { value: BigInt(input.seed) }, selection: { kind: 'all' } },
            reporting: { outputRenderer, reporters: [] }
        },
        lifecycle: input.lifecycle,
        environment: 'fresh-invocation'
    });
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

export function createCampaignWorker(baselines: Readonly<Map<string, CampaignBaseline>>): CampaignWorker {
    const cancellation = new AbortController();
    const ownership = {
        root: new Map<'sandbox', string>(),
        registering: new Set<'started'>(),
        session: new Map<'active', RunExecutionSession>(),
        sessionInput: new Map<'active', SessionRequest['session']>(),
        authority: new Map<'frozen', FrozenMicrotestPolicy>()
    };
    async function register(sandbox: string): Promise<CampaignResponse> {
        if (ownership.registering.has('started')) {
            throw new Error('Campaign worker is already registered.');
        }
        ownership.registering.add('started');
        ownership.root.set('sandbox', await realpath(sandbox));
        return { kind: 'accepted' };
    }
    async function release(): Promise<CampaignResponse> {
        await ownership.session.get('active')?.dispose();
        ownership.session.clear();
        return { kind: 'accepted' };
    }
    function validateSession(request: SessionRequest): void {
        if (request.session.policy.cwd !== registeredRoot(ownership.root)) {
            throw new Error('Isolated execution does not belong to the registered sandbox.');
        }
        if (
            ownership.session.has('active') && !isDeepStrictEqual(ownership.sessionInput.get('active'), request.session)
        ) {
            throw new Error('Campaign execution policy changed.');
        }
        if (!isDeepStrictEqual(ownership.authority.get('frozen'), request.session.policy)) {
            throw new Error('Campaign execution conflicts with its frozen policy authority.');
        }
    }
    async function invoke(
        request: SessionRequest,
        signal: AbortSignal,
        timeoutMilliseconds: number
    ): Promise<CampaignResponse> {
        validateSession(request);
        const execution = ownership.session.get('active') ?? createOwnedExecution(request.session);
        ownership.session.set('active', execution);
        ownership.sessionInput.set('active', request.session);
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
        const policy = await initializeMutationPolicy({
            cwd,
            sandbox: request.sandbox,
            settings: parseRunnerOptions(request.settings),
            signal
        });
        ownership.authority.set('frozen', policy);
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
                return { kind: 'timeout', data: null };
            }
            return { kind: 'failure', failure: runExecutionFailure(error), data: null };
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
            return publishBaseline(baselines, sandbox, request.baseline);
        }
        if (request.kind === 'fetch') {
            return fetchBaseline(baselines, sandbox);
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
