import { runIfMain } from '#test-runner';
import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as transportTestNode } from './supervised-child-transport.test.ts';
import { testNode as schemas } from './child-process-schema.test.ts';
import { testNode as shutdown } from './child-process-shutdown.test.ts';

export const testNode = createSuite({
    title: 'native process policy',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ transportTestNode, schemas, shutdown ]
});
await runIfMain(import.meta, testNode);
