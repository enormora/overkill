import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runtimeAttachmentOwnershipTestNode } from './runtime-attachment-ownership.test.ts';
import { testNode as runtimeAttachmentsTestNode } from './runtime-attachment-lifecycle.test.ts';
import { testNode as resourceLifecycleCompositionTestNode } from './resource-lifecycle-composition.test.ts';
import { testNode as resourceLifecycleBoundariesTestNode } from './resource-lifecycle-boundaries.test.ts';
import { testNode as resourceLifecycleProjectionTestNode } from './resource-lifecycle-projection.test.ts';
import { testNode as resourceLifecycleStartupBudgetTestNode } from './resource-lifecycle-startup-budget.test.ts';
import { testNode as resourceLifecycleTimingTestNode } from './resource-lifecycle-timing.test.ts';
import { testNode as retryResourceLifecycleTestNode } from './retry-resource-lifecycle.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/resource-lifecycle-run-suite.test.ts',
    children: [
        runtimeAttachmentsTestNode,
        runtimeAttachmentOwnershipTestNode,
        retryResourceLifecycleTestNode,
        resourceLifecycleBoundariesTestNode,
        resourceLifecycleCompositionTestNode,
        resourceLifecycleProjectionTestNode,
        resourceLifecycleStartupBudgetTestNode,
        resourceLifecycleTimingTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
