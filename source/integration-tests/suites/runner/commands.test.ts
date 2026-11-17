import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as publishedRunnerTestNode } from '../../../test-support/published-runner.test.ts';
import { testNode as commandLineDefaultsTestNode } from '../../../run/command-line-defaults.test.ts';
import { testNode as runnerDebugTestNode } from '../../run/runner-debug.test.ts';
import { testNode as standardSubpathsTestNode } from '../../../packages/test/standard-subpaths.test.ts';
import { testNode as runnerExplicitFilesTestNode } from '../../run/runner-explicit-files.test.ts';
import { testNode as runnerFileSetsTestNode } from '../../run/runner-file-sets.test.ts';
import { testNode as runnerOutputTestNode } from '../../run/runner-output.test.ts';
import { testNode as runnerCommandLineTestNode } from '../../run/runner-command-line.test.ts';

export const testNode = createSuite({
    title: 'runner commands integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        publishedRunnerTestNode,
        commandLineDefaultsTestNode,
        runnerDebugTestNode,
        standardSubpathsTestNode,
        runnerExplicitFilesTestNode,
        runnerFileSetsTestNode,
        runnerOutputTestNode,
        runnerCommandLineTestNode
    ]
});
