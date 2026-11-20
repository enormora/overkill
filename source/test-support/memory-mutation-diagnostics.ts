import { type DeterministicClock, createDeterministicClock } from '@enormora/clock';

import type { InvocationBudget } from '../invocation-budget.ts';
import type { RunExecutionReply } from '../run/execution-session-types.ts';
import { createInvocationBudget } from '../packages/run/run.entry-point.ts';
import type {
    MutationDiagnosticContext,
    MutationDiagnosticDocument
} from '../packages/stryker-runner/mutation-diagnostic-storage.ts';
import type { MutationDiagnosticRuntime } from '../packages/stryker-runner/mutation-diagnostic-persistence.ts';
import { exchangedAttachment } from './attachment-exchange.ts';
import { mutationCoverageFixture } from './mutation-coverage-fixture.ts';

type MutationDiagnosticFixture = {
    readonly context: MutationDiagnosticContext;
    readonly runtime: MutationDiagnosticRuntime;
    readonly documents: readonly MutationDiagnosticDocument[];
    readonly clock: DeterministicClock;
    readonly budget: InvocationBudget;
    readonly reply: Extract<RunExecutionReply, { readonly kind: 'result'; }>;
};
const invocationMilliseconds = 50;
export function memoryMutationDiagnostics(
    mode: MutationDiagnosticContext['mode'],
    failure: Error | null
): MutationDiagnosticFixture {
    const clock = createDeterministicClock({ initialUnixEpochMicroseconds: 0n });
    const budget = createInvocationBudget(invocationMilliseconds, null, clock);
    const documents: MutationDiagnosticDocument[] = [];
    const context: MutationDiagnosticContext = {
        mode,
        directory: '/project/diagnostics',
        root: '/project',
        campaign: 'campaign',
        seed: '42',
        profile: 'unit'
    };
    const runtime: MutationDiagnosticRuntime = {
        identifier() {
            return 'invocation';
        },
        async write(_context, document) {
            if (failure !== null) {
                throw failure;
            }
            documents.push(document);
        }
    };
    const { reply } = mutationCoverageFixture('off');
    return {
        context,
        runtime,
        documents,
        clock,
        budget,
        reply: { ...reply, result: { ...reply.result, artifacts: [ exchangedAttachment ] } }
    };
}
