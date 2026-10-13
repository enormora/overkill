import {
    normalizeConfig,
    orchestrator,
    parseFrozenMicrotestPolicy,
    RunResolutionError,
    type CollectedRun,
    type FrozenMicrotestPolicy,
    type FrozenRunCommand,
    type RunOrchestrator,
    type RunSeed,
    type RunSelection
} from '../run/run.entry-point.ts';

type RunResult = Awaited<ReturnType<RunOrchestrator['run']>>;

type MutationExecutionInput = {
    readonly policy: FrozenMicrotestPolicy;
    readonly seed: RunSeed;
};

export type MutationExecution = {
    readonly run: (selection: RunSelection) => Promise<RunResult>;
    readonly dispose: () => Promise<void>;
};

function frozenExecutionCommand(input: MutationExecutionInput): FrozenRunCommand {
    const { outputRenderer } = normalizeConfig({});
    return {
        kind: 'frozen-policy',
        policy: parseFrozenMicrotestPolicy(input.policy),
        invocation: { seed: { value: input.seed.value }, selection: { kind: 'all' } },
        reporting: { outputRenderer, reporters: [] }
    };
}

export function createMutationExecution(input: MutationExecutionInput): MutationExecution {
    const baseline = frozenExecutionCommand(input);
    const controller = new AbortController();
    let collection: Promise<CollectedRun> | null = null;
    const active = new Set<Promise<RunResult>>();
    let disposal: Promise<void> | null = null;

    function command(selection: RunSelection): FrozenRunCommand {
        return {
            ...baseline,
            invocation: { ...baseline.invocation, selection }
        };
    }

    async function collect(): Promise<CollectedRun> {
        const initialized = await orchestrator.initialize(command({ kind: 'all' }));
        return await initialized.collect();
    }

    async function execute(selection: RunSelection): Promise<RunResult> {
        if (baseline.policy.profile.execution.processModel === 'supervised-process') {
            return await orchestrator.run(command(selection), { signal: controller.signal, timing: null });
        }
        collection = collection ?? collect();
        const collected = await collection;
        return await collected.run({ selection });
    }

    async function finishDisposal(): Promise<void> {
        await Promise.allSettled(active);
    }

    return {
        async run(selection) {
            if (controller.signal.aborted) {
                throw new RunResolutionError('Mutation execution has been disposed.', undefined, 'invalid-request');
            }
            if (active.size > 0) {
                throw new RunResolutionError(
                    'A mutation invocation is already running.',
                    undefined,
                    'invalid-request'
                );
            }
            const invocation = execute(selection);
            active.add(invocation);
            try {
                return await invocation;
            } finally {
                active.delete(invocation);
            }
        },
        async dispose() {
            controller.abort();
            disposal = disposal ?? finishDisposal();
            await disposal;
        }
    };
}
