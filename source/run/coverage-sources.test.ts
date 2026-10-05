import { createSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as typeOnlyTestNode } from './coverage-type-only.test.ts';
import { testNode as sourceMapTestNode } from './coverage-source-map.test.ts';
import { testNode as mapSelectionTestNode } from './coverage-map-selection.test.ts';
import { testNode as mapContentTestNode } from './coverage-map-content.test.ts';

export const testNode = createSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'coverage source selection',
    children: [ typeOnlyTestNode, sourceMapTestNode, mapSelectionTestNode, mapContentTestNode ]
});

const { runIfMain } = await import('../test-support/run-if-main.ts');

await runIfMain(import.meta, testNode);
