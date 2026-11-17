import { mergeResourceCheckSnapshots } from '../resource-check-snapshot.ts';
import type { ResourceCheckSnapshot, ResourceCheckFailure } from '../resource-check-protocol.ts';
import { workIdentityKey, type WorkId, type AttemptId } from './identity.ts';
import type { TestOutcome } from './run-result.ts';

function snapshotFailure(
    snapshot: ResourceCheckSnapshot,
    work: WorkId,
    attempt: AttemptId
): readonly ResourceCheckFailure[] {
    const { interval } = snapshot;
    if (interval.kind !== 'attempt' || interval.attempt.index !== attempt.index) {
        return [];
    }
    if (workIdentityKey(interval.work) !== workIdentityKey(work)) {
        return [];
    }
    const [ first, ...remaining ] = snapshot.failures;
    return first === undefined
        ? []
        : [ {
            kind: 'resource-check',
            owner: snapshot.owner,
            resource: snapshot.resource,
            interval,
            failures: [ first, ...remaining ]
        } ];
}
export function resourceCheckedOutcome(
    outcome: TestOutcome | null,
    snapshots: readonly ResourceCheckSnapshot[],
    work: WorkId,
    attempt: AttemptId
): TestOutcome | null {
    const [ first, ...remaining ] = mergeResourceCheckSnapshots(snapshots).flatMap(function failedChecks(snapshot) {
        return snapshotFailure(snapshot, work, attempt);
    });
    if (first === undefined) {
        return outcome;
    }
    return {
        kind: 'fail',
        failures: outcome?.kind === 'fail' ? [ ...outcome.failures, first, ...remaining ] : [ first, ...remaining ]
    };
}
