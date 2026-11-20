import { suite } from '@overkill-dev/test';

import { testNode as commandLineListRunnerErrorsTestNode } from './command-line-list-runner-errors.test.ts';
import { testNode as commandLineListRunnerTestNode } from './command-line-list-runner.test.ts';

export const testNode = suite('source/run/command-line-list-runner-suite.test.ts', [
    commandLineListRunnerErrorsTestNode,
    commandLineListRunnerTestNode
]);
