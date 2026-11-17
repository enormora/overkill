import { suite } from '../packages/test/test.entry-point.ts';
import { testNode as calibrationTestNode } from './calibration-suite.test.ts';
import { testNode as executionContractsTestNode } from './benchmark-execution-contracts.test.ts';
import { testNode as rawEvidenceTestNode } from './benchmark-raw-evidence.test.ts';
import { testNode as measurementContractsTestNode } from './measurement-contracts.test.ts';
import { testNode as benchmarkAuthoringTestNode } from './benchmark-authoring.test.ts';
import { testNode as benchmarkBudgetTestNode } from './benchmark-budget.test.ts';
import { testNode as measurementLifecycleTestNode } from './measurement-lifecycle.test.ts';
import { testNode as processContractsTestNode } from './process-contracts.test.ts';
import { testNode as timelineMeasurementTestNode } from './timeline-measurement.test.ts';

export const testNode = suite('benchmark measurement', [
    calibrationTestNode,
    measurementContractsTestNode,
    executionContractsTestNode,
    rawEvidenceTestNode,
    benchmarkAuthoringTestNode,
    benchmarkBudgetTestNode,
    measurementLifecycleTestNode,
    processContractsTestNode,
    timelineMeasurementTestNode
]);
