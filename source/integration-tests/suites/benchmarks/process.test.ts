import { suite } from '@overkill-dev/test';

import { testNode as runnerBenchmarkGarbageCollectionTestNode } from '../../run/runner-benchmark-garbage-collection.test.ts';
import { testNode as runnerBenchmarkHostTestNode } from '../../run/runner-benchmark-host.test.ts';
import { testNode as moduleImportSessionTestNode } from '../../../bench/module-import-session.test.ts';
import { testNode as processTimelineTestNode } from '../../../bench/process-timeline.test.ts';
import { testNode as moduleContractsTestNode } from '../../../bench/module-contracts.test.ts';

import { testNode as processProbeSessionTestNode } from '../../../bench/process-probe-session.test.ts';

export const testNode = suite('benchmarks process integration', [
    runnerBenchmarkGarbageCollectionTestNode,
    runnerBenchmarkHostTestNode,
    moduleImportSessionTestNode,
    processTimelineTestNode,
    moduleContractsTestNode,

    processProbeSessionTestNode
]);
