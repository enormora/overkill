import { suite } from '@overkill-dev/test';

import { testNode as commandLineRunnerRuntimeSelectionTestNode } from './command-line-runner-runtime-selection.test.ts';
import { testNode as commandLineRunnerTestNode } from './command-line-runner.test.ts';

export const testNode = suite('source/packages/test/command-line-runner-selection-suite.test.ts', [
    commandLineRunnerTestNode,
    commandLineRunnerRuntimeSelectionTestNode
]);
