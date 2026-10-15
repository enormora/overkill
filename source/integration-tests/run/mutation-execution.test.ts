import { z } from 'zod/v4';
import {
    normalizeConfig,
    orchestrator,
    restoreRunExecutionFailure,
    RunResolutionError,
    type FrozenMicrotestPolicy,
    type RunOrchestrator,
    type RunSelection
} from '../../packages/run/run.entry-point.ts';
import {
    mutationSelectionLifecycleUrl,
    createMutationSelectionLifecycle
} from './mutation-selection-lifecycle.test.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;
type MutationExecutionInput = {
    readonly policy: FrozenMicrotestPolicy;
    readonly seed: { readonly value: bigint; };
    readonly freshState: boolean;
};
export type MutationExecution = {
    readonly run: (selection: RunSelection) => Promise<RunResult>;
    readonly dispose: () => Promise<void>;
};
const invocationTimeoutMilliseconds = 30_000;

function assertInvocationAdmission(signal: AbortSignal, active: boolean): void {
    if (signal.aborted) {
        throw new RunResolutionError('Mutation execution has been disposed.', undefined, 'invalid-request');
    }
    if (active) {
        throw new RunResolutionError('A mutation invocation is already running.', undefined, 'invalid-request');
    }
}

async function executeSelection(
    session: ReturnType<RunOrchestrator['createExecutionSession']>,
    selection: RunSelection,
    signal: AbortSignal
): Promise<RunResult> {
    const reply = await session.run({
        data: z.json().parse(selection),
        timeoutMilliseconds: invocationTimeoutMilliseconds,
        signal
    });
    if (reply.kind === 'failure') {
        throw restoreRunExecutionFailure(reply.failure);
    }
    if (reply.kind === 'timeout') {
        throw new Error('Mutation execution exceeded its invocation deadline.');
    }
    return reply.result;
}

export function createMutationExecution(input: MutationExecutionInput): MutationExecution {
    const { outputRenderer } = normalizeConfig({});
    const session = orchestrator.createExecutionSession({
        command: {
            kind: 'frozen-policy',
            policy: input.policy,
            invocation: { seed: input.seed, selection: { kind: 'all' } },
            reporting: { outputRenderer, reporters: [] }
        },
        lifecycle: { moduleUrl: mutationSelectionLifecycleUrl, exportName: createMutationSelectionLifecycle.name },
        environment: input.freshState ? 'fresh-invocation' : 'profile-default'
    });
    const controller = new AbortController();
    const active = new Set<symbol>();
    return {
        async run(selection) {
            assertInvocationAdmission(controller.signal, active.size > 0);
            const invocation = Symbol('mutation-invocation');
            active.add(invocation);
            try {
                return await executeSelection(session, selection, controller.signal);
            } finally {
                active.delete(invocation);
            }
        },
        async dispose() {
            controller.abort();
            await session.dispose();
        }
    };
}
