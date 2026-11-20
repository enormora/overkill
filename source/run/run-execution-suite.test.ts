import { suite } from '@overkill-dev/test';

import { testNode as durationHistoryTestNode } from './duration-history.test.ts';
import { testNode as supervisedRunTestNode } from './supervised-run-suite.test.ts';
import { testNode as workerPoolTestNode } from './worker-pool-suite.test.ts';
import { testNode as collectedLifecycleTestNode } from './collected-run-suite.test.ts';
import { testNode as benchmarkMetadataTestNode } from './benchmark-report-metadata.test.ts';

export const testNode = suite('source/run/run-execution-suite.test.ts', [
    benchmarkMetadataTestNode,
    collectedLifecycleTestNode,
    durationHistoryTestNode,
    supervisedRunTestNode,
    workerPoolTestNode
]);
