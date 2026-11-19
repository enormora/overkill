import { suite } from '@overkill-dev/test';

import { testNode as runnerMutationExecutionTestNode } from '../../run/runner-mutation-execution.test.ts';
import { testNode as runnerMutationCostTestNode } from '../../run/runner-mutation-cost.test.ts';
import { testNode as runnerMutationBoundariesTestNode } from '../../run/runner-mutation-boundaries.test.ts';
import { testNode as runnerMutationPolicyTestNode } from '../../run/runner-mutation-policy.test.ts';
import { testNode as runnerFrozenPolicyTestNode } from '../../run/runner-frozen-policy.test.ts';
import { testNode as runnerFrozenPolicyActivationTestNode } from '../../run/runner-frozen-policy-activation.test.ts';

export const testNode = suite('stryker campaigns integration', [
    runnerMutationExecutionTestNode,
    runnerMutationCostTestNode,
    runnerMutationBoundariesTestNode,
    runnerMutationPolicyTestNode,
    runnerFrozenPolicyTestNode,
    runnerFrozenPolicyActivationTestNode
]);
