import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testSuite as identityTestSuite } from '../../engine/identity.test.ts';
import { testSuite as reporterDeliveryCleanupTestSuite } from '../../engine/reporter-delivery-cleanup.test.ts';
import { testSuite as reporterDeliveryTestSuite } from '../../engine/reporter-delivery.test.ts';
import { testSuite as reporterEventQueueTestSuite } from '../../engine/reporter-event-queue.test.ts';
import { testSuite as reporterTestSuite } from '../../engine/reporter.test.ts';
import { testSuite as runIfMainTestSuite } from '../../engine/run-if-main.test.ts';
import { testSuite as runResultTestSuite } from '../../engine/run-result.test.ts';
import { testSuite as testNodeTestSuite } from '../../engine/test-node.test.ts';
import { testSuite as enginePlanningTestSuite } from './engine-planning.ts';

export const testSuite = createSuite({
    title: 'source/test-support/unit-suite-groups/engine-support.ts',
    metadata: {},
    children: [
        identityTestSuite,
        reporterDeliveryCleanupTestSuite,
        reporterDeliveryTestSuite,
        reporterEventQueueTestSuite,
        reporterTestSuite,
        runIfMainTestSuite,
        runResultTestSuite,
        testNodeTestSuite,
        enginePlanningTestSuite
    ]
});
