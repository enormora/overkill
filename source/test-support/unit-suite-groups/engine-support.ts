import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as identityTestNode } from '../../engine/identity.test.ts';
import { testNode as reporterDeliveryCleanupTestNode } from '../../engine/reporter-delivery-cleanup.test.ts';
import { testNode as reporterDeliveryTestNode } from '../../engine/reporter-delivery.test.ts';
import { testNode as reporterEventQueueTestNode } from '../../engine/reporter-event-queue.test.ts';
import { testNode as reportingContextTestNode } from '../../engine/reporting-context.test.ts';
import { testNode as reporterSuiteTestNode } from '../../engine/reporter-suite.test.ts';
import { testNode as runResultTestNode } from '../../engine/run-result.test.ts';
import { testNode as testNodeTestNode } from '../../engine/test-node.test.ts';
import { testNode as enginePlanningTestNode } from './engine-planning.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/engine-support.ts',
    metadata: {},
    children: [
        identityTestNode,
        reporterDeliveryCleanupTestNode,
        reporterDeliveryTestNode,
        reporterEventQueueTestNode,
        reportingContextTestNode,
        reporterSuiteTestNode,
        runResultTestNode,
        testNodeTestNode,
        enginePlanningTestNode
    ]
});
