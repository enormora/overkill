import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as collectionTestNode } from './collection.test.ts';
import { testNode as sessionsTestNode } from './sessions.test.ts';
import { testNode as executionTestNode } from './execution.test.ts';
import { testNode as familiesTestNode } from './families.test.ts';
import { testNode as workersTestNode } from './workers.test.ts';

export const testNode = createSuite({
    title: 'runner runtime integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ collectionTestNode, sessionsTestNode, executionTestNode, familiesTestNode, workersTestNode ]
});
