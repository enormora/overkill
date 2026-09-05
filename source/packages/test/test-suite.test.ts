import { createSuite } from '../engine/engine.entry-point.ts';
import { testSuite as commandLineRunnerTestSuite } from './command-line-runner.test.ts';
import { testSuite as standardSubpathsTestSuite } from './standard-subpaths.test.ts';
import { testSuite as entryPointTestSuite } from './test-entry-point.test.ts';

export const testSuite = createSuite({
    title: 'source/packages/test',
    metadata: {},
    children: [
        commandLineRunnerTestSuite,
        standardSubpathsTestSuite,
        entryPointTestSuite
    ]
});
