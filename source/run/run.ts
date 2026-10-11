import { createDirectEntrypointRunner, createRunOperations, type DirectEntrypointRunner } from './run-operations.ts';
import { freezeRunPolicy } from './freeze-run-policy.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { BenchmarkBaselineCommand, RunOrchestrator } from './run-types.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';

function createRunOrchestrator(dependencies: RunOrchestratorDependencies): RunOrchestrator {
    const benchmark = createRunOperations(dependencies, 'bench');
    function baselineVerb(verb: 'apply' | 'bootstrap' | 'diff' | 'update') {
        return async function executeBaselineVerb(
            command: BenchmarkBaselineCommand,
            options: RunInvocationTimingOptions
        ) {
            const { runBenchmarkBaselineVerb } = await import('./benchmark-baseline-operations.ts');
            return await runBenchmarkBaselineVerb({ command, operations: benchmark, options, verb });
        };
    }

    return {
        ...createRunOperations(dependencies, 'test'),
        async freezePolicy(input) {
            return await freezeRunPolicy(input, dependencies);
        },
        bench: {
            baseline: {
                apply: baselineVerb('apply'),
                bootstrap: baselineVerb('bootstrap'),
                diff: baselineVerb('diff'),
                async list(command) {
                    const { listBenchmarkBaselines } = await import('./benchmark-baseline-operations.ts');
                    return await listBenchmarkBaselines(command);
                },
                update: baselineVerb('update')
            },
            list: benchmark.resolve,
            run: benchmark.run,
            runWithReporterDelivery: benchmark.runWithReporterDelivery
        }
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
