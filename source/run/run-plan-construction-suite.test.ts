import { suite } from '@overkill-dev/test';

import { testNode as benchmarkProfileBoundaryTestNode } from './benchmark-profile-boundary.test.ts';
import { testNode as collectedRunPlanTestNode } from './collected-run-plan.test.ts';
import { testNode as runtimeMatrixExpansionTestNode } from './runtime-matrix-expansion.test.ts';

export const testNode = suite('source/run/run-plan-construction-suite.test.ts', [
    benchmarkProfileBoundaryTestNode,
    collectedRunPlanTestNode,
    runtimeMatrixExpansionTestNode
]);
