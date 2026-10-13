import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as measurementRuntimePolicyTestNode } from './measurement-runtime-policy.test.ts';
import { testNode as benchmarkTimeoutEvidenceTestNode } from './benchmark-timeout-evidence.test.ts';
import { testNode as benchmarkEvidenceTestNode } from './benchmark-evidence.test.ts';
import { testNode as benchmarkAuthoringTestNode } from './benchmark-authoring.test.ts';
import { testNode as benchmarkBudgetTestNode } from './benchmark-budget.test.ts';
import { testNode as measurementRegionTestNode } from './measurement-region.test.ts';

export const testNode = suite('benchmark measurement', [
    measurementRuntimePolicyTestNode,
    benchmarkTimeoutEvidenceTestNode,
    benchmarkEvidenceTestNode,
    benchmarkAuthoringTestNode,
    benchmarkBudgetTestNode,
    measurementRegionTestNode
]);
