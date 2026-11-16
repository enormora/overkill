import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as rules } from './rule-testing-suite.test.ts';
import { testNode as configs } from './config-testing-suite.test.ts';

export const testNode = suite('ESLint testing', [ rules, configs ]);
