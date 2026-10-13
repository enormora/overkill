import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as executionContractsTestNode } from './benchmark-execution-contracts.test.ts';
import { testNode as rawEvidenceTestNode } from './benchmark-raw-evidence.test.ts';
import { testNode as measurementContractsTestNode } from './measurement-contracts.test.ts';
import { testNode as benchmarkAuthoringTestNode } from './benchmark-authoring.test.ts';
import { testNode as benchmarkBudgetTestNode } from './benchmark-budget.test.ts';
import { testNode as measurementRegionTestNode } from './measurement-region.test.ts';

export const testNode = suite('benchmark measurement', [
    measurementContractsTestNode,
    executionContractsTestNode,
    rawEvidenceTestNode,
    benchmarkAuthoringTestNode,
    benchmarkBudgetTestNode,
    measurementRegionTestNode
]);
