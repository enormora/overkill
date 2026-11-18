import { createSuite } from '../../../packages/engine/engine.entry-point.ts';
import { testNode as coverageReportingTestNode } from '../../../run/coverage-reporting.test.ts';
import { testNode as runCoverageTestNode } from '../../../run/run-coverage.test.ts';
import { testNode as collectedRunCoverageTestNode } from '../../../run/collected-run-coverage.test.ts';
import { testNode as runnerCoverageBranchesTestNode } from '../../run/runner-coverage-branches.test.ts';
import { testNode as runnerCoverageTestNode } from '../../run/runner-coverage.test.ts';
import { testNode as runnerCoverageSourcesTestNode } from '../../run/runner-coverage-sources.test.ts';

export const testNode = createSuite({
    title: 'runner coverage integration',
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' } ],
    children: [
        coverageReportingTestNode,
        runCoverageTestNode,
        collectedRunCoverageTestNode,
        runnerCoverageBranchesTestNode,
        runnerCoverageTestNode,
        runnerCoverageSourcesTestNode
    ]
});
