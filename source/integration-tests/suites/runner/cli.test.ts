import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as commandsTestNode } from './commands.test.ts';
import { testNode as selectionTestNode } from './selection.test.ts';
import { testNode as configurationTestNode } from './configuration.test.ts';

export const testNode = createSuite({
    title: 'runner cli integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ commandsTestNode, selectionTestNode, configurationTestNode ]
});
