import { createBenchmarkOrchestrator } from './benchmark-orchestrator.ts';
import { createDirectEntrypointRunner, createRunOperations, type DirectEntrypointRunner } from './run-operations.ts';
import { freezeRunPolicy } from './freeze-run-policy.ts';
import { initializeRun } from './initialized-run.ts';
import { createExecutionSession } from './execution-session.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';

function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    return {
        async replayWitness(command, options) {
            const { createPropertyReplayOperations } = await import('./property-replay-command.ts');
            return await createPropertyReplayOperations(dependencies).replayWitness(command, options);
        },
        async replayWitnessWithReporterDelivery(command, options) {
            const { createPropertyReplayOperations } = await import('./property-replay-command.ts');
            return await createPropertyReplayOperations(dependencies).replayWitnessWithReporterDelivery(
                command,
                options
            );
        },
        createExecutionSession(options) {
            return createExecutionSession(options, dependencies);
        },
        ...createRunOperations(dependencies, 'test'),
        async freezePolicy(input) {
            return await freezeRunPolicy(input, dependencies);
        },
        async initialize(command) {
            return await initializeRun(command, dependencies);
        },
        bench: createBenchmarkOrchestrator(dependencies)
    };
}

export type RunCoordinator = {
    readonly orchestrator: RunOrchestrator;
    readonly runDirectEntrypoint: DirectEntrypointRunner;
};

export function createRunCoordinator(dependencies: RunOrchestratorDependencies): RunCoordinator {
    return {
        orchestrator: createRunOrchestrator(dependencies),
        runDirectEntrypoint: createDirectEntrypointRunner(dependencies)
    };
}
