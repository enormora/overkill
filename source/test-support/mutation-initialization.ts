import type {
    MutationInitializationRuntime,
    RunnerInitialization
} from '../packages/stryker-runner/mutation-runner-initialization.ts';
import type { CampaignResponse, CampaignRequest } from '../packages/stryker-runner/campaign-protocol.ts';
import { frozenMicrotestPolicy } from './frozen-microtest-policy.ts';
import { mutationRunnerRuntime } from './mutation-runner-runtime.ts';
import { sandboxFixture } from './mutation-sandbox-paths.ts';

type MutationInitializationFixture = {
    readonly runtime: MutationInitializationRuntime;
    readonly input: RunnerInitialization;
    readonly events: readonly string[];
    readonly requests: readonly CampaignRequest[];
    readonly policyResponse: CampaignResponse;
};
export async function mutationInitialization(
    responses: readonly CampaignResponse[],
    failure: Error | null
): Promise<MutationInitializationFixture> {
    const events: string[] = [];
    const requests: CampaignRequest[] = [];
    const { runner } = mutationRunnerRuntime();
    const policy = await frozenMicrotestPolicy();
    const client = {
        ...runner.client,
        async request(request: CampaignRequest) {
            requests.push(request);
            return responses[requests.length - 1] ?? { kind: 'policy', policy };
        },
        dispose() {
            events.push('dispose');
        }
    };
    return {
        events,
        requests,
        policyResponse: { kind: 'policy', policy },
        input: {
            options: { overkill: { seed: '42' } },
            files: {},
            logger: {
                info() {
                    events.push('log');
                }
            },
            signal: AbortSignal.any([]),
            budget() {
                return null;
            },
            connected() {
                events.push('connected');
            }
        },
        runtime: {
            async sandbox() {
                events.push('sandbox');
                if (failure !== null) {
                    throw failure;
                }
                return sandboxFixture;
            },
            async exclude() {
                events.push('exclude');
            },
            async connect() {
                events.push('connect');
                return client;
            },
            execute() {
                events.push('execute');
                return runner.execution;
            }
        }
    };
}
