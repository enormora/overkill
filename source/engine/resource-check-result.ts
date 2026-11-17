import type { ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import { mergeResourceCheckSnapshots } from '../resource-check-snapshot.ts';
import type { RunResult, RunnerError } from './run-result.ts';

function completedSnapshot(snapshot: ResourceCheckSnapshot): ResourceCheckSnapshot {
    return snapshot.status.kind === 'open'
        ? {
            ...snapshot,
            revision: snapshot.revision + 1,
            status: { kind: 'incomplete', reasons: [ 'Required resource observation did not finalize.' ] }
        }
        : snapshot;
}
function observationError(snapshot: ResourceCheckSnapshot): RunnerError {
    const { interval } = snapshot;
    return {
        attributedTo: interval.kind === 'attempt' ? interval.work.case : null,
        attributedToWork: interval.kind === 'attempt' ? interval.work : null,
        attributedToAttempt: interval.kind === 'attempt' ? interval.attempt : null,
        cause: snapshot,
        diagnostics: [],
        message: 'Required resource observation is incomplete.',
        subtype: 'fixture'
    };
}
export function finalizedResourceCheckResult(result: RunResult, evidence: readonly ResourceCheckSnapshot[]): RunResult {
    const resourceChecks = mergeResourceCheckSnapshots([ ...result.resourceChecks, ...evidence ]).map(
        completedSnapshot
    );
    const incomplete = resourceChecks.filter(function unfinished(snapshot) {
        return snapshot.status.kind === 'incomplete';
    });
    const failed = resourceChecks.some(function failedChecks(snapshot) {
        return snapshot.failures.length > 0;
    });
    return {
        ...result,
        resourceChecks,
        runnerErrors: [ ...result.runnerErrors, ...incomplete.map(observationError) ],
        status: failed || incomplete.length > 0 ? 'failed' : result.status
    };
}
