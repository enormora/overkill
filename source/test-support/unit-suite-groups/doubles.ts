import { suite } from '@overkill-dev/test';

import { testNode as doubleProtocolTestNode } from './double-protocol.ts';
import { testNode as testDoubleRuntimeTestNode } from './test-double-runtime.ts';

export const testNode = suite('source/test-support/unit-suite-groups/doubles.ts', [
    doubleProtocolTestNode,
    testDoubleRuntimeTestNode
]);
