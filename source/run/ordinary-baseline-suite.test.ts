import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as storage } from './ordinary-baseline-storage-policy.test.ts';
import { testNode as workflow } from './baseline-workflow.test.ts';
import { testNode as publication } from './baseline-publication.test.ts';
import { testNode as evaluation } from './baseline-evaluation.test.ts';
import { testNode as inventory } from './baseline-inventory.test.ts';
import { testNode as outcomes } from './baseline-outcomes.test.ts';
import { testNode as snapshots } from './snapshot-suite.test.ts';

import { testNode as sessionPolicy } from './baseline-session-policy.test.ts';

export const testNode = authoredSuite('ordinary baseline execution', [
    storage,
    sessionPolicy,
    workflow,
    publication,
    evaluation,
    inventory,
    outcomes,
    snapshots
]);
