import { workIdentityKey } from './engine/identity.ts';
import type { ResourceCheckSnapshot } from './resource-check-protocol.ts';

export function resourceCheckSnapshotKey(snapshot: ResourceCheckSnapshot): string {
    const { interval } = snapshot;
    return JSON.stringify([
        snapshot.owner.run,
        snapshot.owner.id,
        interval.kind === 'attempt' ? [ workIdentityKey(interval.work), interval.attempt.index ] : 'lifetime'
    ]);
}
export function mergeResourceCheckSnapshots(
    snapshots: readonly ResourceCheckSnapshot[]
): readonly ResourceCheckSnapshot[] {
    const retained = new Map<string, ResourceCheckSnapshot>();
    for (const snapshot of snapshots) {
        const key = resourceCheckSnapshotKey(snapshot);
        if ((retained.get(key)?.revision ?? -1) < snapshot.revision) {
            retained.set(key, snapshot);
        }
    }
    return Array.from(retained.values());
}
