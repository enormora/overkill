import { createSuite } from '../../packages/engine/engine.entry-point.ts';
import { testSuite as doubleProtocolTestSuite } from './double-protocol.ts';
import { testSuite as testDoubleRuntimeTestSuite } from './test-double-runtime.ts';

export const testSuite = createSuite({
    title: 'source/test-support/unit-suite-groups/doubles.ts',
    metadata: {},
    children: [
        doubleProtocolTestSuite,
        testDoubleRuntimeTestSuite
    ]
});
