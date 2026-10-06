import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as hostTestNode } from './worker-pool-host-transport.test.ts';
import { testNode as exitTestNode } from './node-process-exit.test.ts';
import { testNode as transportTestNode } from './supervised-child-transport.test.ts';
import { testNode as observation } from './process-policy-observation.test.ts';
import { testNode as schemas } from './child-process-schema.test.ts';
import { testNode as shutdown } from './child-process-shutdown.test.ts';

export const testNode = createSuite({
    title: 'native process policy',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ hostTestNode, exitTestNode, transportTestNode, observation, schemas, shutdown ]
});
const { runIfMain } = await import('../test-support/run-if-main.ts');
await runIfMain(import.meta, testNode);
