import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as reporterFlushTestNode } from './supervised-reporter-flush.test.ts';
import { testNode as definitionLocationsTestNode } from './supervised-definition-locations.test.ts';
import { testNode as supervisedChildProcessTestNode } from './supervised-child-process.test.ts';
import { testNode as supervisedChildTestNode } from './supervised-child.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-child-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        reporterFlushTestNode,
        definitionLocationsTestNode,
        supervisedChildProcessTestNode,
        supervisedChildTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
