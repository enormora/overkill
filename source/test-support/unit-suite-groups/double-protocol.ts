import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testNode as doubleUsageOrderTestNode } from '../../doubles/double-usage-order.test.ts';
import { testNode as doubleUsageTestNode } from '../../doubles/double-usage.test.ts';
import { testNode as protocolDoubleAssertionsTestNode } from '../../doubles/protocol-double-assertions.test.ts';
import { testNode as protocolDoubleTestNode } from '../../doubles/protocol-double.test.ts';

export const testNode = createSuite({
    definitionLocations: [ { kind: 'unknown' } ],
    title: 'source/test-support/unit-suite-groups/double-protocol.ts',
    annotations: {},
    controls: {},
    children: [
        doubleUsageOrderTestNode,
        doubleUsageTestNode,
        protocolDoubleAssertionsTestNode,
        protocolDoubleTestNode
    ]
});
