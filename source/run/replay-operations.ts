import { replayDiagnostics } from './replay-diagnostics.ts';
import { createRunOperations } from './run-operations.ts';
import { withReplay } from './replay-context.ts';
import { requestedDebug } from './run-debug.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunInvocationOptions } from './run-types.ts';
import type { ReplayWitnessCommand } from './witness-replay-request.ts';
import type { PreparedReplay, ReplayOperations, ReplayContext, ReplayWitnessInput } from './replay-types.ts';

function isWitnessReplayCommand(value: ReplayWitnessCommand | ReplayWitnessInput): value is ReplayWitnessCommand {
    return Object.hasOwn(value, 'request');
}

export function createReplayOperations(dependencies: RunOrchestratorDependencies): ReplayOperations {
    async function execute(
        input: Pick<ReplayContext, 'signal'>,
        prepared: PreparedReplay,
        timing: RunInvocationOptions['timing']
    ): ReturnType<ReplayOperations['replayWithReporterDelivery']> {
        const operations = createRunOperations(
            dependencies,
            prepared.command.config.profiles[prepared.command.request.profile]?.testFamily === 'benchmark'
                ? 'bench'
                : 'test'
        );
        return withReplay(prepared.replay, input.signal, async function replayWithDelivery() {
            const delivery = await operations.runWithReporterDelivery(prepared.command, {
                signal: input.signal,
                timing
            });
            return {
                ...delivery,
                result: {
                    ...delivery.result,
                    maintenanceDiagnostics: [
                        ...delivery
                            .result
                            .maintenanceDiagnostics,
                        ...replayDiagnostics(prepared.replay)
                    ]
                }
            };
        });
    }
    const replayWithReporterDelivery: ReplayOperations['replayWithReporterDelivery'] = async function replay(input) {
        const { prepareRecordedReplay } = await import('./replay-preparation.ts');
        const prepared = await prepareRecordedReplay({ ...input, debug: requestedDebug(input) }, dependencies);
        return await execute(input, prepared, null);
    };
    const replayWitnessWithReporterDelivery = async function replay(
        command: ReplayWitnessCommand | ReplayWitnessInput,
        ...options: readonly [] | readonly [RunInvocationOptions]
    ): ReturnType<ReplayOperations['replayWitnessWithReporterDelivery']> {
        const { prepareWitnessReplay } = await import('./replay-preparation.ts');
        const { preparePropertyReplay } = await import('./property-replay-command.ts');
        const invocation = options[0] ?? { signal: null, timing: null };
        const prepared = isWitnessReplayCommand(command)
            ? await preparePropertyReplay(command)
            : await prepareWitnessReplay({ ...command, debug: requestedDebug(command) });
        const { signal } = isWitnessReplayCommand(command) ? invocation : command;
        return await execute({ signal }, prepared, invocation.timing);
    };
    return {
        replayWithReporterDelivery,
        replayWitnessWithReporterDelivery,
        async replay(input) {
            const delivery = await replayWithReporterDelivery(input);
            return delivery.result;
        },
        async replayWitness(
            input: ReplayWitnessCommand | ReplayWitnessInput,
            ...options: readonly [] | readonly [RunInvocationOptions]
        ) {
            const delivery = await replayWitnessWithReporterDelivery(input, ...options);
            return delivery.result;
        }
    };
}
