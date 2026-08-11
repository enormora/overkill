import { createSuite } from '@overkill-dev/engine';
import { testSuite as doubleUsageOrderTestSuite } from '../../doubles/double-usage-order.test.ts';
import { testSuite as doubleUsageTestSuite } from '../../doubles/double-usage.test.ts';
import { testSuite as protocolDoubleAssertionsTestSuite } from '../../doubles/protocol-double-assertions.test.ts';
import { testSuite as protocolDoubleTestSuite } from '../../doubles/protocol-double.test.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/double-protocol.ts',
    metadata: {},
    children: [
        doubleUsageOrderTestSuite,
        doubleUsageTestSuite,
        protocolDoubleAssertionsTestSuite,
        protocolDoubleTestSuite
    ]
});
