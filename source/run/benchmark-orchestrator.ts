import { createRunOperations } from './run-operations.ts';
import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';
import type { BenchmarkBaselineCommand, BenchmarkOrchestrator } from './run-types.ts';
import type { RunInvocationTimingOptions } from './run-timing-collection.ts';

export function createBenchmarkOrchestrator(dependencies: RunOrchestratorDependencies): BenchmarkOrchestrator {
    const benchmark = createRunOperations(dependencies, 'bench');
    const calibration = createRunOperations(dependencies, 'bench-calibrate');
    function baselineVerb(verb: 'apply' | 'bootstrap' | 'diff' | 'update') {
        return async function executeBaselineVerb(
            command: BenchmarkBaselineCommand,
            options: RunInvocationTimingOptions
        ) {
            const { runBenchmarkBaselineVerb } = await import('./benchmark-baseline-execution.ts');
            return await runBenchmarkBaselineVerb({ command, operations: benchmark, options, verb });
        };
    }
    return {
        calibrate: calibration.runWithReporterDelivery,
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
    };
}
