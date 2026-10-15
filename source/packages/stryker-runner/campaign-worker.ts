import { realpath } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import {
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
export type CampaignWorker = {
    readonly respond: (request: WorkerRequest) => Promise<CampaignResponse>;
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
    if (baseline === undefined) {
        throw new Error('Campaign dry-run baseline is unavailable.');
    }
    return { kind: 'baseline', baseline };
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
    function registeredRoot(): string {
        const sandbox = ownership.root.get('sandbox');
        if (sandbox === undefined) {
            throw new Error('Campaign worker must register first.');
        }
        return sandbox;
    }
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
    async function invoke(request: SessionRequest): Promise<CampaignResponse> {
        if (request.session.policy.cwd !== registeredRoot()) {
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
        const execution = ownership.session.get('active') ?? createOwnedExecution(request.session);
        ownership.session.set('active', execution);
        ownership.sessionInput.set('active', request.session);
        return await execution.run({
            data: request.data,
            timeoutMilliseconds: request.deadlineUnixMilliseconds - Date.now(),
            signal: cancellation.signal
        });
    }
    async function freezeRegisteredPolicy(
        request: Extract<WorkerRequest, { readonly kind: 'resolve-policy'; }>
    ): Promise<CampaignResponse> {
        const cwd = registeredRoot();
        if (request.sandbox.root !== cwd || ownership.authority.has('frozen')) {
            throw new Error('Campaign policy registration is invalid.');
        }
        const policy = await initializeMutationPolicy({
            cwd,
            sandbox: request.sandbox,
            settings: parseRunnerOptions(request.settings),
            signal: cancellation.signal
        });
        ownership.authority.set('frozen', policy);
        return { kind: 'policy', policy };
    }
    async function resolvePolicy(
        request: Extract<WorkerRequest, { readonly kind: 'resolve-policy'; }>
    ): Promise<CampaignResponse> {
        try {
            return await freezeRegisteredPolicy(request);
        } catch (error: unknown) {
            return { kind: 'failure', failure: runExecutionFailure(error), data: null };
        }
    }
    async function respondRegistered(
        request: Exclude<WorkerRequest, { readonly kind: 'register' | 'release'; }>
    ): Promise<CampaignResponse> {
        const sandbox = registeredRoot();
        if (request.kind === 'resolve-policy') {
            return await resolvePolicy(request);
        }
        if (request.kind === 'publish') {
            return publishBaseline(baselines, sandbox, request.baseline);
        }
        if (request.kind === 'fetch') {
            return fetchBaseline(baselines, sandbox);
        }
        return await invoke(request);
    }
    return {
        async respond(request) {
            if (request.kind === 'release') {
                return await release();
            }
            cancellation.signal.throwIfAborted();
            return request.kind === 'register' ? await register(request.root) : await respondRegistered(request);
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
