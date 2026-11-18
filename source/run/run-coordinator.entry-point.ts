import { createBenchmarkOrchestrator } from './benchmark-orchestrator.ts';
import { createReplayOperations } from './replay-operations.ts';
import { createDirectEntrypointRunner, createRunOperations, type DirectEntrypointRunner } from './run-operations.ts';
import { freezeRunPolicy } from './freeze-run-policy.ts';
import { initializeRun } from './initialized-run.ts';
import { createExecutionSession } from './execution-session.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { RunOrchestrator } from './run-orchestrator-types.ts';

function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    return {
        ...createReplayOperations(dependencies),
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
        baseline: {
            async apply(command, options) {
                const { createBaselineOperations } = await import('./baseline-operations.ts');
                return await createBaselineOperations(createRunOperations(dependencies, 'baseline')).apply(
                    command,
                    options
                );
            },
            async bootstrap(command, options) {
                const { createBaselineOperations } = await import('./baseline-operations.ts');
                return await createBaselineOperations(createRunOperations(dependencies, 'baseline')).bootstrap(
                    command,
                    options
                );
            },
            async diff(command, options) {
                const { createBaselineOperations } = await import('./baseline-operations.ts');
                return await createBaselineOperations(createRunOperations(dependencies, 'baseline')).diff(
                    command,
                    options
                );
            },
            async list(command) {
                const { createBaselineOperations } = await import('./baseline-operations.ts');
                return await createBaselineOperations(createRunOperations(dependencies, 'baseline')).list(command);
            },
            async update(command, options) {
                const { createBaselineOperations } = await import('./baseline-operations.ts');
                return await createBaselineOperations(createRunOperations(dependencies, 'baseline')).update(
                    command,
                    options
                );
            }
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
