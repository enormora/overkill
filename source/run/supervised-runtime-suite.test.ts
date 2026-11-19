import { suite } from '@overkill-dev/test';

import { testNode as processPolicyTestNode } from './process-policy-suite.test.ts';
import { testNode as supervisedChildSuiteTestNode } from './supervised-child-suite.test.ts';
import { testNode as supervisedRunProcessPolicyTestNode } from './supervised-run-process-policy.test.ts';
import { testNode as supervisedRunRuntimeTestNode } from './supervised-run-runtime.test.ts';
import { testNode as supervisedRuntimePolicyErrorsTestNode } from './supervised-runtime-policy-errors.test.ts';

export const testNode = suite('source/run/supervised-runtime-suite.test.ts', [
    processPolicyTestNode,
    supervisedChildSuiteTestNode,
    supervisedRunProcessPolicyTestNode,
    supervisedRunRuntimeTestNode,
    supervisedRuntimePolicyErrorsTestNode
]);
