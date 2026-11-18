import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as configurationTestNode } from './eslint/configuration.test.ts';
import { testNode as rulesTestNode } from './eslint/rules.test.ts';

export const testNode = createSuite({
    title: 'eslint integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ configurationTestNode, rulesTestNode ]
});
