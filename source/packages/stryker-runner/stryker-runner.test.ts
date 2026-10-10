import { suite } from '../test/test.entry-point.ts';
import { testNode as profileTestNode } from './microtest-profile.test.ts';
import { testNode as settingsTestNode } from './runner-options.test.ts';
import { testNode as policyTestNode } from './mutation-execution-policy.test.ts';

export const testNode = suite('Stryker profile initialization', [ profileTestNode, settingsTestNode, policyTestNode ]);
