import { suite as authoredSuite } from '@overkill-dev/test';

import { testNode as timelineMeasurementTestNode } from './timeline-measurement.test.ts';
import { testNode as executionPolicy } from './process-execution-policy.test.ts';
import { testNode as calibrationTestNode } from './calibration-suite.test.ts';
import { testNode as executionContractsTestNode } from './benchmark-execution-contracts.test.ts';
import { testNode as measurementContractsTestNode } from './measurement-contracts.test.ts';
import { testNode as benchmarkAuthoringTestNode } from './benchmark-authoring.test.ts';
import { testNode as benchmarkBudgetTestNode } from './benchmark-budget.test.ts';
import { testNode as measurementLifecycleTestNode } from './measurement-lifecycle.test.ts';
import { testNode as processContractsTestNode } from './process-contracts.test.ts';

export const testNode = authoredSuite('benchmark measurement', [
    executionPolicy,
    calibrationTestNode,
    measurementContractsTestNode,
    executionContractsTestNode,
    benchmarkAuthoringTestNode,
    benchmarkBudgetTestNode,
    measurementLifecycleTestNode,
    processContractsTestNode,
    timelineMeasurementTestNode
]);
