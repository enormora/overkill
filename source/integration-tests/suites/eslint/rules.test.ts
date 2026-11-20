import { suite } from '@overkill-dev/test';

import { testNode as rulePropertiesTestNode } from '../../../eslint-test/rule-properties.test.ts';
import { testNode as runnerEslintTestTestNode } from '../../run/runner-eslint-test.test.ts';
import { testNode as runnerEslintPropertiesTestNode } from '../../run/runner-eslint-properties.test.ts';

export const testNode = suite('eslint rules integration', [
    rulePropertiesTestNode,
    runnerEslintTestTestNode,
    runnerEslintPropertiesTestNode
]);
