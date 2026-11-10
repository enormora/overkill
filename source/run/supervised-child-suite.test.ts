import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as reporterFlushTestNode } from './supervised-reporter-flush.test.ts';
import { testNode as definitionLocationsTestNode } from './supervised-definition-locations.test.ts';
import { testNode as supervisedChildProcessTestNode } from './supervised-child-process.test.ts';
import { testNode as supervisedChildTestNode } from './supervised-child.test.ts';
import { testNode as childProcessStartersTestNode } from './node-child-process-starters.test.ts';
import { testNode as nativeArtifactsTestNode } from './supervised-native-artifacts.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-child-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        reporterFlushTestNode,
        definitionLocationsTestNode,
        childProcessStartersTestNode,
        nativeArtifactsTestNode,
        supervisedChildProcessTestNode,
        supervisedChildTestNode
    ]
});

await runIfMain(import.meta, testNode);
