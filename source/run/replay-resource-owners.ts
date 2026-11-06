import { workIdentityKey } from '../engine/identity.ts';
import { collectedRunCaseEntries } from './collected-run-plan.ts';
import type { PlacementPlan, CollectedRunPlan } from './run-types.ts';

export function availableReplayResourceOwners(plan: PlacementPlan, collection: CollectedRunPlan): PlacementPlan {
    const cases = new Map(
        collectedRunCaseEntries(collection).map(function keyed(entry) {
            return [ workIdentityKey(entry.workId), entry.testCase.resourceAttachments.resourceGraph ];
        })
    );
    const owners = plan.resourceOwnership.owners.flatMap(function available(owner) {
        const work = owner.work.filter(function ownsResource(identity) {
            return cases.get(workIdentityKey(identity))?.some(function matches(resource) {
                return resource.name === owner.resourceName;
            }) === true;
        });
        const [ first, ...rest ] = work;
        return first === undefined ? [] : [ { ...owner, work: [ first, ...rest ] as const } ];
    });
    return { ...plan, resourceOwnership: { owners } };
}
