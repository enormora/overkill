import { workIdentityKey } from '../engine/identity.ts';
import { artifactsForAttempt } from '../engine/run-artifact.ts';
import { appendRunnerErrors } from '../engine/execution-result.ts';
import type { RetryArtifactPolicy } from '../config/execution.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import type { CollectedRunPlan } from './run-types.ts';
import type {
    ReporterDelivery,
    RunResult,
    RunArtifact,
    PerTestResult,
    RunnerError,
    ReporterEvent
} from './run-engine-primitives.ts';
import { retainedRetryArtifacts } from './retry-artifact-retention.ts';

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

function terminalCaseEvent(
    result: PerTestResult,
    suitePath: Extract<ReporterEvent, { readonly kind: 'test-end'; }>['suitePath'],
    artifacts: readonly RunArtifact[]
): Extract<ReporterEvent, { readonly kind: 'test-end'; }> {
    const attempt = result.attempts.at(-1) ?? result.attempts[0];
    return {
        kind: 'test-end',
        completion: 'final',
        attempt: attempt.attempt.index,
        artifacts: artifactsForAttempt(artifacts, result.workId, attempt.attempt),
        case: result.id,
        workId: result.workId,
        definitionLocations: result.definitionLocations,
        suitePath,
        property: result.property,
        benchmark: result.benchmark,
        outcome: result.outcome,
        verdict: result.verdict,
        durationMicroseconds: attempt.durationMicroseconds
    };
}

export async function reportTerminalCases(
    result: RunResult,
    pending: readonly PerTestResult[],
    plan: CollectedRunPlan,
    delivery: Pick<ReporterDelivery, 'reportEvent'>
): Promise<RunResult> {
    const cases = new Map(
        collectedRunCaseEntries(plan).map(function plannedCase(entry) {
            return [ workIdentityKey(entry.workId), entry.testCase ] as const;
        })
    );
    const results = new Map(result.perTest.map(function completedCase(entry) {
        return [ workIdentityKey(entry.workId), entry ] as const;
    }));
    const terminals = new Map(pending.map(function pendingCase(entry) {
        return [ workIdentityKey(entry.workId), entry ] as const;
    }));
    const errors: RunnerError[] = [];
    for (const [ key, terminal ] of terminals) {
        const completed = results.get(key) ?? terminal;
        const suitePath = cases.get(key)?.suitePath ?? completed.id.suite.map(function unknownSuite(title) {
            return { title, definitionLocations: [ { kind: 'unknown' as const } ] };
        });
        errors.push(...await delivery.reportEvent(terminalCaseEvent(completed, suitePath, result.artifacts)));
    }
    return appendRunnerErrors(result, errors);
}
