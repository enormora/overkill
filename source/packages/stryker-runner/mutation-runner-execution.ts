import type { JsonValue } from 'type-fest';
import {
    normalizeConfig,
    orchestrator,
    type FrozenMicrotestPolicy,
    type RunExecutionReply
} from '../run/run.entry-point.ts';
import type { CampaignClient } from './campaign-client.ts';
import { mutationLifecycleUrl } from './mutation-lifecycle.ts';

export type MutationRunnerExecution = {
    readonly admitEnvironment: (mode: 'dry' | 'runtime' | 'static', reload: boolean) => void;
    readonly environmentLifetime: 'fresh' | 'reused';
    readonly run: (data: JsonValue, timeoutMilliseconds: number) => Promise<RunExecutionReply>;
    readonly dispose: () => Promise<void>;
};

type MutationRunnerExecutionInput = {
    readonly policy: FrozenMicrotestPolicy;
    readonly seed: string;
    readonly freshState: boolean;
    readonly client: CampaignClient;
    readonly signal: AbortSignal;
};
export function createMutationRunnerExecution(input: MutationRunnerExecutionInput): MutationRunnerExecution {
    const { policy, seed, freshState, client, signal } = input;
    let loaded: 'pristine' | 'runtime' | 'static' = 'pristine';
    const lifecycle = { moduleUrl: mutationLifecycleUrl, exportName: 'createMutationLifecycle' };
    const fresh = freshState || policy.profile.execution.processModel === 'supervised-process';
    const { outputRenderer } = normalizeConfig({});
    const local = fresh ? null : orchestrator.createExecutionSession({
        command: {
            kind: 'frozen-policy',
            policy,
            invocation: { seed: { value: BigInt(seed) }, selection: { kind: 'all' } },
            reporting: { outputRenderer, reporters: [] }
        },
        lifecycle,
        environment: 'profile-default'
    });
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
        async run(data, timeoutMilliseconds) {
            signal.throwIfAborted();
            if (local !== null) {
                return await local.run({ data, timeoutMilliseconds, signal });
            }
            const reply = await client.request({
                kind: 'invoke',
                session: { policy, seed, lifecycle },
                data,
                deadlineUnixMilliseconds: Date.now() + timeoutMilliseconds
            });
            if (reply.kind !== 'result' && reply.kind !== 'failure' && reply.kind !== 'timeout') {
                throw new Error('Campaign IPC returned an invalid execution reply.');
            }
            return reply;
        },
        async dispose() {
            if (local === null) {
                if (!signal.aborted) {
                    await client.request({ kind: 'release' });
                }
            } else {
                await local.dispose();
            }
        }
    };
}
