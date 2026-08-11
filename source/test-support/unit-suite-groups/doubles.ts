import { createSuite } from '@overkill-dev/engine';
import { testSuite as doubleProtocolTestSuite } from './double-protocol.ts';
import { testSuite as testDoubleRuntimeTestSuite } from './test-double-runtime.ts';

export const testSuite = createSuite({
    name: 'source/test-support/unit-suite-groups/doubles.ts',
    metadata: {},
    children: [
        doubleProtocolTestSuite,
        testDoubleRuntimeTestSuite
    ]
});
