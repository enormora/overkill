import { ConfigError } from './config-error.ts';
import { defaultBenchmarkTimeoutPolicy } from './defaults.ts';
import type { ProfileConfig, TimeoutPolicy } from './types.ts';

type ProfileExecution = ProfileConfig['execution'];

function validateBenchmarkAdmission(execution: ProfileExecution): void {
    if (execution.scheduling !== 'serial' || execution.maxConcurrency !== 1) {
        throw new ConfigError('Benchmark execution requires serial scheduling and maxConcurrency 1.');
    }
    if (execution.processModel !== 'supervised-process' && execution.processModel !== 'worker-pool') {
        throw new ConfigError('Benchmark execution requires supervised-process or worker-pool.');
    }
}

function validateBenchmarkWorkerPool(
    execution: Extract<ProfileExecution, { readonly processModel: 'worker-pool'; }>
): void {
    if (execution.hedging.mode !== 'off') {
        throw new ConfigError('Benchmark execution does not support hedging.');
    }
    if (
        execution.workDistribution.mode === 'group' && execution.workDistribution.groups.some(
            function hasConcurrentScheduling(group) {
                return group.scheduling === 'concurrent';
            }
        )
    ) {
        throw new ConfigError('Benchmark work groups do not support concurrent scheduling.');
    }
}

export function validateBenchmarkExecution(execution: ProfileExecution, timeouts: TimeoutPolicy): void {
    validateBenchmarkAdmission(execution);
    if (timeouts.hardMilliseconds > defaultBenchmarkTimeoutPolicy.hardMilliseconds) {
        throw new ConfigError('Benchmark hard timeout must not exceed 60000 milliseconds.');
    }
    if (execution.processModel === 'worker-pool') {
        validateBenchmarkWorkerPool(execution);
    }
}
