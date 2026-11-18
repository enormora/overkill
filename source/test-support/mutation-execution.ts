import type { TestScope } from '../packages/test/test.entry-point.ts';
import type {
    RunExecutionReply,
    RunExecutionInvocation,
    RunExecutionSessionOptions
} from '../packages/run/run.entry-point.ts';
import {
    createCampaignMutationExecution,
    type MutationRunnerExecution,
    type MutationRunnerExecutionInput,
    type MutationExecutionSessionFactory
} from '../packages/stryker-runner/mutation-runner-execution.ts';
import { frozenMicrotestPolicy } from './frozen-microtest-policy.ts';
import { mutationInvocations, type MutationInvocationFixture } from './mutation-invocations.ts';

type MutationExecutionFixture = MutationInvocationFixture & {
    readonly execution: MutationRunnerExecution;
    readonly input: MutationRunnerExecutionInput;
    readonly createSession: MutationExecutionSessionFactory;
    readonly initialized: readonly RunExecutionSessionOptions[];
    readonly local: readonly RunExecutionInvocation[];
    readonly disposals: readonly string[];
};
export async function mutationExecution(
    scope: TestScope,
    freshState: boolean,
    reply: RunExecutionReply
): Promise<MutationExecutionFixture> {
    const fixture = mutationInvocations(scope, null, reply);
    const initialized: RunExecutionSessionOptions[] = [];
    const local: RunExecutionInvocation[] = [];
    const disposals: string[] = [];
    const input: MutationRunnerExecutionInput = {
        policy: await frozenMicrotestPolicy(),
        seed: '42',
        freshState,
        signal: scope.signal,
        client: {
            ...fixture.runner.client,
            async request(request) {
                if (request.kind === 'release') {
                    disposals.push('release');
                    return { kind: 'accepted' };
                }
                return reply;
            }
        }
    };
    const createSession: MutationExecutionSessionFactory = function (options) {
        initialized.push(options);
        return {
            environmentLifetime: 'reused',
            async run(invocation) {
                local.push(invocation);
                return reply;
            },
            async dispose() {
                disposals.push('local');
            }
        };
    };
    return {
        ...fixture,
        input,
        createSession,
        initialized,
        local,
        disposals,
        execution: createCampaignMutationExecution(input, createSession)
    };
}
