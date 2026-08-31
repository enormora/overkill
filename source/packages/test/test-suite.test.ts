import { createSuite } from '@overkill-dev/engine';
import { testSuite as commandLineRunnerTestSuite } from './command-line-runner.test.ts';
import { testSuite as entryPointTestSuite } from './test-entry-point.test.ts';

export const testSuite = createSuite({
    name: 'source/packages/test',
    metadata: {},
    children: [
        commandLineRunnerTestSuite,
        entryPointTestSuite
    ]
});
