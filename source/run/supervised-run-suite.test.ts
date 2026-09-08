import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as supervisedRunArtifactsTestNode } from './supervised-run-artifacts.test.ts';
import { testNode as supervisedRunStateTestNode } from './supervised-run-state.test.ts';
import { testNode as supervisedRunTestNode } from './supervised-run.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-run-suite.test.ts',
    metadata: {},
    children: [
        supervisedRunTestNode,
        supervisedRunArtifactsTestNode,
        supervisedRunStateTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
