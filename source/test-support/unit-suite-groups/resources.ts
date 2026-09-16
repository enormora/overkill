import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as directResourceLifecycleTestNode } from '../../resources/direct-resource-lifecycle.test.ts';
import { testNode as resourceLifecycleDisposalTestNode } from '../../resources/resource-lifecycle-disposal.test.ts';
import { testNode as resourceLifecycleTestNode } from '../../resources/resource-lifecycle.test.ts';
import {
    testNode as resourceWrapperCompositionCoreTestNode
} from '../../resources/resource-wrapper-composition-core.test.ts';
import { testNode as resourcesTestNode } from '../../resources/resources.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'resources',
    annotations: {},
    controls: {},
    children: [
        directResourceLifecycleTestNode,
        resourceLifecycleDisposalTestNode,
        resourceLifecycleTestNode,
        resourceWrapperCompositionCoreTestNode,
        resourcesTestNode
    ]
});
