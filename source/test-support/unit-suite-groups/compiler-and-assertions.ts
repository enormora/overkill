import { suite } from '@overkill-dev/test';

import { testNode as typeTests } from '../../packages/type-test/type-test-suite.test.ts';
import { testNode as assertions } from './assert-and-run.ts';

export const testNode = suite('assertions and compiler adapters', [ typeTests, assertions ]);
