import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as rulePropertiesTestNode } from '../../../eslint-test/rule-properties.test.ts';
import { testNode as runnerEslintTestTestNode } from '../../run/runner-eslint-test.test.ts';
import { testNode as runnerEslintPropertiesTestNode } from '../../run/runner-eslint-properties.test.ts';

export const testNode = createSuite({
    title: 'eslint rules integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [ rulePropertiesTestNode, runnerEslintTestTestNode, runnerEslintPropertiesTestNode ]
});
