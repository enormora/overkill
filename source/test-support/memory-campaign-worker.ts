import {
    type CampaignWorker,
    createCampaignSession,
    type CampaignWorkerRuntime
} from '../packages/stryker-runner/campaign-worker.ts';
import type { MutationSandbox } from '../packages/stryker-runner/mutation-sandbox.ts';
import type { FrozenMicrotestPolicy } from '../run/run-types.ts';
import type { RunExecutionInvocation } from '../packages/run/run.entry-point.ts';
import type { CampaignBaseline } from '../packages/stryker-runner/mutation-catalog.ts';
import { frozenMicrotestPolicy } from './frozen-microtest-policy.ts';

type CampaignWorkerFixture = {
    readonly worker: CampaignWorker;
    readonly runtime: CampaignWorkerRuntime;
    readonly policy: FrozenMicrotestPolicy;
    readonly calls: readonly string[];
    readonly authorities: readonly Parameters<CampaignWorkerRuntime['execution']>[0][];
    readonly invocations: readonly RunExecutionInvocation[];
    readonly baselines: ReadonlyMap<string, CampaignBaseline>;
    readonly campaigns: ReadonlyMap<string, string>;
    readonly sandbox: MutationSandbox;
};
export async function memoryCampaignWorker(policyFailure: Error | null): Promise<CampaignWorkerFixture> {
    const policy = await frozenMicrotestPolicy();
    const calls: string[] = [];
    const authorities: Parameters<CampaignWorkerRuntime['execution']>[0][] = [];
    const invocations: RunExecutionInvocation[] = [];
    const baselines = new Map<string, CampaignBaseline>();
    const campaigns = new Map<string, string>();
    const runtime: CampaignWorkerRuntime = {
        async canonicalRoot() {
            calls.push('canonicalRoot');
            return '/project';
        },
        identify() {
            calls.push('identify');
            return '00000000-0000-4000-8000-000000000000';
        },
        async policy() {
            calls.push('policy');
            if (policyFailure !== null) {
                throw policyFailure;
            }
            return policy;
        },
        execution(authority) {
            authorities.push(authority);
            calls.push('execution');
            return {
                environmentLifetime: 'fresh',
                async run(invocation) {
                    invocations.push(invocation);
                    return { kind: 'timeout', artifacts: [], data: invocation.data };
                },
                async dispose() {
                    calls.push('dispose');
                }
            };
        }
    };
    const worker = createCampaignSession({ baselines, campaigns }, runtime);
    const sandbox = { originalRoot: '/project', root: '/project', sharedRoots: [], files: [] };
    return { worker, runtime, policy, calls, authorities, invocations, baselines, campaigns, sandbox };
}
