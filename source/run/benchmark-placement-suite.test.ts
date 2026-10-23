import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as placementExecutionTestNode } from '../integration-tests/run/runner-benchmark-placement.test.ts';
import { testNode as placementTestNode } from './benchmark-placement.test.ts';

import { testNode as planningTestNode } from './benchmark-placement-planning.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'adaptive benchmark placement',
    children: [ placementTestNode, planningTestNode, placementExecutionTestNode ]
});

await runIfMain(import.meta, testNode);
