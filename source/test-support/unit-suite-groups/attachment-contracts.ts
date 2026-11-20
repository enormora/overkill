import { suite } from '@overkill-dev/test';
import { testNode as timelineMeasurement } from '../../bench/timeline-measurement.test.ts';
import { testNode as moduleEvidence } from '../../bench/module-evidence.test.ts';
import { testNode as snapshotEvidence } from '../../run/snapshot-evidence.test.ts';
import { testNode as snapshotComparison } from '../../run/snapshot-comparison.test.ts';

import { testNode as runtimeAttachmentFailure } from '../../run/runtime-attachment-failure.test.ts';
import { testNode as runtimeAttachmentResults } from '../../run/runtime-attachment-results.test.ts';
import { testNode as runtimeAttachmentLifecycle } from '../../run/runtime-attachment-lifecycle.test.ts';
import { testNode as ownership } from './attachment-ownership.ts';

import { testNode as resourceEvidence } from './resource-evidence.ts';

export const testNode = suite('inline attachment contracts', [
    resourceEvidence,
    timelineMeasurement,
    moduleEvidence,
    snapshotEvidence,
    snapshotComparison,
    ownership,
    runtimeAttachmentFailure,
    runtimeAttachmentResults,
    runtimeAttachmentLifecycle
]);
