import type { JsonValue } from 'type-fest';
import {
    type InvocationBudget,
    normalizeConfig,
    orchestrator,
    type FrozenMicrotestPolicy,
    type RunExecutionReply,
    type RunExecutionSession,
    type RunExecutionSessionOptions
} from '../run/run.entry-point.ts';
import type { CampaignClient } from './campaign-client.ts';
import { mutationLifecycleUrl } from './mutation-lifecycle.ts';

export type MutationRunnerExecution = {
    readonly admitEnvironment: (mode: 'dry' | 'runtime' | 'static', reload: boolean) => void;
    readonly environmentLifetime: 'fresh' | 'reused';
    readonly run: (data: JsonValue, budget: InvocationBudget) => Promise<RunExecutionReply>;
    readonly dispose: () => Promise<void>;
};

export type MutationRunnerExecutionInput = {
    readonly policy: FrozenMicrotestPolicy;
    readonly seed: string;
    readonly freshState: boolean;
    readonly client: CampaignClient;
    readonly signal: AbortSignal;
};
export type MutationExecutionSessionFactory = (options: RunExecutionSessionOptions) => RunExecutionSession;
export function mutationSessionOptions(
    policy: FrozenMicrotestPolicy,
    seed: string,
    environment: RunExecutionSessionOptions['environment']
): RunExecutionSessionOptions {
    const { outputRenderer } = normalizeConfig({});
    return {
        command: {
            kind: 'frozen-policy',
            policy,
            invocation: { seed: { value: BigInt(seed) }, selection: { kind: 'all' } },
            reporting: { outputRenderer, reporters: [] }
        },
        lifecycle: { moduleUrl: mutationLifecycleUrl, exportName: 'createMutationLifecycle' },
        environment
    };
}

export function createCampaignMutationExecution(
    input: MutationRunnerExecutionInput,
    createSession: MutationExecutionSessionFactory
): MutationRunnerExecution {
    const { policy, seed, freshState, client, signal } = input;
    let loaded: 'pristine' | 'runtime' | 'static' = 'pristine';
    const fresh = freshState || policy.profile.execution.processModel === 'supervised-process';
    const local = fresh ? null : createSession(mutationSessionOptions(policy, seed, 'profile-default'));
    return {
        admitEnvironment(mode, reload) {
            const replacement = reload || [ loaded, mode ].includes('static');
            if (!fresh && loaded !== 'pristine' && replacement) {
                throw new Error(
                    'Loaded native ESM requires Stryker worker replacement for reload or static transitions.'
                );
            }
            loaded = mode === 'dry' ? 'runtime' : mode;
        },
        environmentLifetime: fresh ? 'fresh' : 'reused',
        async run(data, budget) {
            signal.throwIfAborted();
            if (local !== null) {
                return await local.run({
                    data,
                    timeoutMilliseconds: budget.remainingMilliseconds(),
                    signal: AbortSignal.any([ signal, budget.signal ])
                });
            }
            const reply = await client.request({
                kind: 'invoke',
                data
            }, budget);
            if (reply.kind !== 'result' && reply.kind !== 'failure' && reply.kind !== 'timeout') {
                throw new Error('Campaign IPC returned an invalid execution reply.');
            }
            return reply;
        },
        async dispose() {
            if (local === null) {
                if (!signal.aborted) {
                    await client.request({ kind: 'release' }, null);
                }
            } else {
                await local.dispose();
            }
        }
    };
}

export function createMutationRunnerExecution(input: MutationRunnerExecutionInput): MutationRunnerExecution {
    return createCampaignMutationExecution(input, orchestrator.createExecutionSession);
}
