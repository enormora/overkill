import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as doubleProtocolTestNode } from './double-protocol.ts';
import { testNode as testDoubleRuntimeTestNode } from './test-double-runtime.ts';

export const testNode = createSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/test-support/unit-suite-groups/doubles.ts',
    metadata: {},
    children: [
        doubleProtocolTestNode,
        testDoubleRuntimeTestNode
    ]
});
