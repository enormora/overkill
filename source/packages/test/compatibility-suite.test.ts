import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as compatibilityEntryPointTestNode } from './compatibility-entry-point.test.ts';
import { testNode as skippedTestEntryPointTestNode } from './skipped-test-entry-point.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test compatibility authoring',
    annotations: {},
    controls: {},
    children: [
        compatibilityEntryPointTestNode,
        skippedTestEntryPointTestNode
    ]
});
