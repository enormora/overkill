import { replayDiagnostics } from './replay-diagnostics.ts';
import { createRunOperations } from './run-operations.ts';
import { withReplay } from './replay-context.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { PreparedReplay, ReplayOperations, ReplayContext } from './replay-types.ts';

export function createReplayOperations(dependencies: RunOrchestratorDependencies): ReplayOperations {
    async function execute(
        input: ReplayContext,
        prepared: PreparedReplay
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
                timing: null
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
        return await execute(input, await prepareRecordedReplay(input, dependencies));
    };
    const replayWitnessWithReporterDelivery: ReplayOperations['replayWitnessWithReporterDelivery'] =
        async function replay(input) {
            const { prepareWitnessReplay } = await import('./replay-preparation.ts');
            return await execute(input, await prepareWitnessReplay(input, dependencies));
        };
    return {
        replayWithReporterDelivery,
        replayWitnessWithReporterDelivery,
        async replay(input) {
            const delivery = await replayWithReporterDelivery(input);
            return delivery.result;
        },
        async replayWitness(input) {
            const delivery = await replayWitnessWithReporterDelivery(input);
            return delivery.result;
        }
    };
}
