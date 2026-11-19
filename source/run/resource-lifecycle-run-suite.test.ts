import { suite } from '@overkill-dev/test';

import { testNode as acquisition } from './managed-resource-acquisition-policy.test.ts';
import { testNode as startupClock } from './resource-startup-clock.test.ts';
import { testNode as matrix } from './resource-lifecycle-matrix-policy.test.ts';
import { testNode as resourceLifecycleCompositionTestNode } from './resource-lifecycle-composition.test.ts';
import { testNode as resourceLifecycleBoundariesTestNode } from './resource-lifecycle-boundaries.test.ts';
import { testNode as resourceLifecycleProjectionTestNode } from './resource-lifecycle-projection.test.ts';
import { testNode as retryResourceLifecycleTestNode } from './retry-resource-lifecycle.test.ts';

export const testNode = suite('source/run/resource-lifecycle-run-suite.test.ts', [
    acquisition,
    startupClock,
    matrix,
    retryResourceLifecycleTestNode,
    resourceLifecycleBoundariesTestNode,
    resourceLifecycleCompositionTestNode,
    resourceLifecycleProjectionTestNode
]);
