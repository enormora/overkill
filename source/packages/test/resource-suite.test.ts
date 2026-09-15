import { createSuite } from '../engine/engine.entry-point.ts';
import { testNode as resourceBindingExecutionTestNode } from './resource-binding-execution.test.ts';
import { testNode as standardSubpathsTestNode } from './standard-subpaths.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/packages/test/resource-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        resourceBindingExecutionTestNode,
        standardSubpathsTestNode
    ]
});
