import { suite } from '@overkill-dev/test';

import { testNode as snapshotTestNode } from '../../../run/snapshot.test.ts';

import { testNode as snapshotPreparationTestNode } from '../../../run/snapshot-preparation.test.ts';
import { testNode as snapshotSharingTestNode } from '../../../run/snapshot-sharing.test.ts';
import { testNode as runnerContentSnapshotsTestNode } from '../../run/runner-content-snapshots.test.ts';

export const testNode = suite('persistence snapshots integration', [
    snapshotTestNode,

    snapshotPreparationTestNode,
    snapshotSharingTestNode,
    runnerContentSnapshotsTestNode
]);
