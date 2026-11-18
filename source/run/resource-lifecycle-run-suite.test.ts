import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as acquisition } from './managed-resource-acquisition-policy.test.ts';
import { testNode as startupClock } from './resource-startup-clock.test.ts';
import { testNode as matrix } from './resource-lifecycle-matrix-policy.test.ts';
import { testNode as resourceLifecycleCompositionTestNode } from './resource-lifecycle-composition.test.ts';
import { testNode as resourceLifecycleBoundariesTestNode } from './resource-lifecycle-boundaries.test.ts';
import { testNode as resourceLifecycleProjectionTestNode } from './resource-lifecycle-projection.test.ts';
import { testNode as retryResourceLifecycleTestNode } from './retry-resource-lifecycle.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/resource-lifecycle-run-suite.test.ts',
    children: [
        acquisition,
        startupClock,
        matrix,
        retryResourceLifecycleTestNode,
        resourceLifecycleBoundariesTestNode,
        resourceLifecycleCompositionTestNode,
        resourceLifecycleProjectionTestNode
    ]
});

await runIfMain(import.meta, testNode);
