import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as rules } from './rule-testing-suite.test.ts';
import { testNode as configs } from './config-testing-suite.test.ts';

export const testNode = authoredSuite('ESLint testing', [ rules, configs ]);
