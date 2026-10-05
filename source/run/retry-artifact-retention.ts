import { workIdentityKey } from '../engine/identity.ts';
import type { PerTestResult, RunArtifact } from '../engine/run-result.ts';
import type { RetryArtifactPolicy } from './run-execution-config.ts';

function retainedAttemptIndexes(result: PerTestResult, policy: RetryArtifactPolicy): ReadonlySet<number> {
    const failures = result.attempts.filter(function failedAttempt(attempt) {
        return attempt.verdict !== 'pass' && attempt.verdict !== 'skip';
    });
    const failure = policy === 'first-failure-and-final' ? failures.at(0) : failures.at(-1);
    const indexes = new Set<number>();
    const final = result.attempts.at(-1);
    if (final !== undefined) {
        indexes.add(final.attempt.index);
    }
    if (failure !== undefined) {
        indexes.add(failure.attempt.index);
    }
    return indexes;
}

export function retainedRetryArtifacts(
    artifacts: readonly RunArtifact[],
    results: readonly PerTestResult[],
    policy: RetryArtifactPolicy
): readonly RunArtifact[] {
    if (policy === 'all') {
        return artifacts;
    }
    const selected = new Map<string, ReadonlySet<number>>();
    for (const result of results) {
        selected.set(workIdentityKey(result.workId), retainedAttemptIndexes(result, policy));
    }
    return artifacts.filter(function selectedAttempt(artifact) {
        if (artifact.id.scope.kind === 'run' || artifact.id.attempt === null) {
            return true;
        }
        const key = workIdentityKey({
            case: artifact.id.scope.case,
            runtimes: artifact.id.runtimes,
            workload: artifact.id.workload
        });
        return selected.get(key)?.has(artifact.id.attempt.index) ?? true;
    });
}
