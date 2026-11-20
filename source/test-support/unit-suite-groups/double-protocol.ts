import { suite } from '@overkill-dev/test';
import { testNode as failures } from '../../doubles/iterator-method-failures.test.ts';

import { testNode as doubleUsageOrderTestNode } from '../../doubles/double-usage-order.test.ts';
import { testNode as doubleUsageTestNode } from '../../doubles/double-usage.test.ts';
import { testNode as protocolDoubleAssertionsTestNode } from '../../doubles/protocol-double-assertions.test.ts';
import { testNode as protocolDoubleTestNode } from '../../doubles/protocol-double.test.ts';

export const testNode = suite('source/test-support/unit-suite-groups/double-protocol.ts', [
    failures,
    doubleUsageOrderTestNode,
    doubleUsageTestNode,
    protocolDoubleAssertionsTestNode,
    protocolDoubleTestNode
]);
