import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as doubleProtocolTestNode } from './double-protocol.ts';
import { testNode as testDoubleRuntimeTestNode } from './test-double-runtime.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/doubles.ts',
    annotations: {},
    controls: {},
    children: [
        doubleProtocolTestNode,
        testDoubleRuntimeTestNode
    ]
});
