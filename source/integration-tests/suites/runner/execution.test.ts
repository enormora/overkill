import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as childProcessOutboxTestNode } from '../../../run/child-process-outbox.test.ts';
import { testNode as collectedRunTestNode } from '../../../run/collected-run.test.ts';
import { testNode as collectedRunBoundariesTestNode } from '../../../run/collected-run-boundaries.test.ts';
import { testNode as runnerSupervisedCancellationTestNode } from '../../run/runner-supervised-cancellation.test.ts';
import { testNode as runnerCollectedLifecycleTestNode } from '../../run/runner-collected-lifecycle.test.ts';
import { testNode as runnerIpcResultsTestNode } from '../../run/runner-ipc-results.test.ts';
import { testNode as runnerSupervisedTimeoutsTestNode } from '../../run/runner-supervised-timeouts.test.ts';

export const testNode = createSuite({
    title: 'runner execution integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        childProcessOutboxTestNode,
        collectedRunTestNode,
        collectedRunBoundariesTestNode,
        runnerSupervisedCancellationTestNode,
        runnerCollectedLifecycleTestNode,
        runnerIpcResultsTestNode,
        runnerSupervisedTimeoutsTestNode
    ]
});
