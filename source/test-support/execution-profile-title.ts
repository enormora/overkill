import type { BenchmarkExecution, IntegrationExecution } from '../config/types.ts';

export function executionTitle(execution: BenchmarkExecution | IntegrationExecution): string {
    return execution.processModel === 'worker-pool'
        ? [
            execution.processModel,
            execution.hostProcess.kind,
            execution.workerLifecycle,
            execution.dispatchPolicy,
            execution.scheduling
        ]
            .join(', ')
        : [ execution.processModel, execution.scheduling ].join(', ');
}
