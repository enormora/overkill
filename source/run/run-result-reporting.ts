import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { ReporterDelivery, RunResult, RunArtifact } from './run-engine-primitives.ts';
import { retainedRetryArtifacts } from './retry-artifact-retention.ts';
import type { RetryArtifactPolicy } from './run-execution-config.ts';

export function resultWithRetainedArtifacts(
    result: RunResult,
    artifacts: readonly RunArtifact[],
    policy: RetryArtifactPolicy
): RunResult {
    return {
        ...result,
        artifacts: retainedRetryArtifacts([ ...result.artifacts, ...artifacts ], result.perTest, policy)
    };
}

export async function reportResultWithDelivery(
    result: RunResult,
    reporterDelivery: ReporterDelivery
): Promise<RunResult> {
    const runEndErrors = await reporterDelivery.reportEvent({ kind: 'run-end', result });
    const resultForFinalReporting = appendRunnerErrors(result, runEndErrors);
    const finalReporterErrors = await reporterDelivery.reportResult(resultForFinalReporting);
    const disposeErrors = await reporterDelivery.disposeReporters();
    return appendRunnerErrors(resultForFinalReporting, [ ...finalReporterErrors, ...disposeErrors ]);
}
