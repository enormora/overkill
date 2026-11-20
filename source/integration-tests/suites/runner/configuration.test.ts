import { suite } from '@overkill-dev/test';

import { testNode as familyProfileTestNode } from '../../../config/family-profile.test.ts';
import { testNode as frozenRunPolicyTestNode } from '../../../run/frozen-run-policy.test.ts';

export const testNode = suite('runner configuration integration', [
    familyProfileTestNode,
    frozenRunPolicyTestNode
]);
