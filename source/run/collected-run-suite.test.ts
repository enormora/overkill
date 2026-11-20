import { suite } from '@overkill-dev/test';

import { testNode as budgets } from '../invocation-budget.test.ts';
import { testNode as executionFailure } from './execution-failure.test.ts';
import { testNode as selectionPolicy } from './collected-invocation-policy.test.ts';

export const testNode = suite('public collected runner lifecycle', [
    selectionPolicy,
    executionFailure,
    budgets
]);
