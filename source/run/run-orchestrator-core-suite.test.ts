import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runSelectionTestNode } from './run-selection.test.ts';
import { testNode as runTestNode } from './run.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-orchestrator-core-suite.test.ts',
    metadata: {},
    children: [
        runSelectionTestNode,
        runTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
