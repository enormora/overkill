import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as executionPlanCompatibilityTestNode } from './execution-plan-compatibility.test.ts';
import { testNode as executionPlanResolutionTestNode } from './execution-plan-resolution.test.ts';
import { testNode as workerPoolCollectionTestNode } from './worker-pool-collection.test.ts';
import { testNode as workerPoolCoreTestNode } from './worker-pool-core-suite.test.ts';
import { testNode as workerPoolHostTestNode } from './worker-pool-host-suite.test.ts';
import { testNode as workerPoolRunBoundaryTestNode } from './worker-pool-run-boundary.test.ts';
import { testNode as workerPoolWorkerTimingTestNode } from './worker-pool-worker-timing.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/worker-pool-suite.test.ts',
    children: [
        executionPlanCompatibilityTestNode,
        executionPlanResolutionTestNode,
        workerPoolCollectionTestNode,
        workerPoolCoreTestNode,
        workerPoolHostTestNode,
        workerPoolRunBoundaryTestNode,
        workerPoolWorkerTimingTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
