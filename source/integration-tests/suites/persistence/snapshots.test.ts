import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as snapshotTestNode } from '../../../run/snapshot.test.ts';

import { testNode as snapshotPreparationTestNode } from '../../../run/snapshot-preparation.test.ts';
import { testNode as snapshotSharingTestNode } from '../../../run/snapshot-sharing.test.ts';
import { testNode as runnerContentSnapshotsTestNode } from '../../run/runner-content-snapshots.test.ts';

export const testNode = createSuite({
    title: 'persistence snapshots integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        snapshotTestNode,

        snapshotPreparationTestNode,
        snapshotSharingTestNode,
        runnerContentSnapshotsTestNode
    ]
});
