import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runIfMainOptionsTestNode } from './run-if-main-options.test.ts';
import { testNode as runIfMainProfileFileSetsTestNode } from './run-if-main-profile-file-sets.test.ts';
import { testNode as runIfMainSelectionTestNode } from './run-if-main-selection.test.ts';
import { testNode as runIfMainTestNode } from './run-if-main.test.ts';
import { testNode as directEntrypointCollectionTestNode } from './direct-entrypoint-collection.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-if-main-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        directEntrypointCollectionTestNode,
        runIfMainOptionsTestNode,
        runIfMainProfileFileSetsTestNode,
        runIfMainSelectionTestNode,
        runIfMainTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
