import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as planning } from './benchmark-placement-planning.test.ts';
import { testNode as placementTestNode } from './benchmark-placement.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'adaptive benchmark placement',
    children: [ planning, placementTestNode ]
});

await runIfMain(import.meta, testNode);
