import { createDeterministicClock, type DeterministicClock } from '@enormora/clock';
import type { JsonValue } from 'type-fest';
import {
    createInvocationBudget,
    type InvocationBudget,
    type RunExecutionReply
} from '../packages/run/run.entry-point.ts';
import { createStoredValue } from '../stored-value.ts';
import {
    createMutationRunnerInvocations,
    type MutationRunnerInvocations
} from '../packages/stryker-runner/mutation-runner-invocations.ts';
import { createMutationBaseline } from '../packages/stryker-runner/mutation-baseline.ts';
import { campaignBaselineSchema, type CampaignBaseline } from '../packages/stryker-runner/mutation-catalog.ts';
import type { ReadyMutationRunner } from '../packages/stryker-runner/mutation-runner-initialization.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';

const invocationMilliseconds = 50;
export type MutationInvocationFixture = {
    readonly runner: ReadyMutationRunner;
    readonly clock: DeterministicClock;
    readonly budget: InvocationBudget;
    readonly invocations: MutationRunnerInvocations;
    readonly admissions: readonly string[];
    readonly executions: readonly JsonValue[];
    readonly calls: readonly string[];
    readonly baseline: () => CampaignBaseline | null;
};
export function mutationInvocations(
    scope: TestScope,
    baseline: CampaignBaseline | null,
    reply: RunExecutionReply
): MutationInvocationFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const budget = createInvocationBudget(invocationMilliseconds, null, clock);
    scope.cleanup(budget.dispose);
    const campaign = createStoredValue(baseline);
    const admissions: string[] = [];
    const executions: JsonValue[] = [];
    const calls: string[] = [];
    return {
        clock,
        budget,
        admissions,
        executions,
        calls,
        baseline: campaign.read,
        invocations: createMutationRunnerInvocations(createMutationBaseline(), false),
        runner: {
            root: '/project',
            diagnostics: {
                mode: 'off',
                directory: '/diagnostics',
                root: '/project',
                campaign: 'campaign',
                seed: '42',
                profile: 'unit'
            },
            client: {
                async request(request) {
                    calls.push(request.kind);
                    if (request.kind === 'fetch') {
                        return { kind: 'baseline', baseline: campaign.read() };
                    }
                    if (request.kind === 'publish') {
                        campaign.write(campaignBaselineSchema.parse(request.baseline));
                    }
                    return { kind: 'accepted' };
                },
                dispose() {
                    calls.push('dispose');
                },
                async expireRequests() {
                    calls.push('expire');
                }
            },
            execution: {
                environmentLifetime: 'reused',
                admitEnvironment(mode, reload) {
                    admissions.push(`${mode}:${String(reload)}`);
                },
                async run(data) {
                    executions.push(data);
                    return reply;
                },
                async dispose() {
                    calls.push('execution.dispose');
                }
            }
        }
    };
}
