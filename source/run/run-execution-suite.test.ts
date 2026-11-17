import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as durationHistoryTestNode } from './duration-history.test.ts';
import { testNode as supervisedRunTestNode } from './supervised-run-suite.test.ts';
import { testNode as workerPoolTestNode } from './worker-pool-suite.test.ts';
import { testNode as collectedLifecycleTestNode } from './collected-run-suite.test.ts';
import { testNode as benchmarkMetadataTestNode } from './benchmark-report-metadata.test.ts';

export const testNode = createOverkillSuite({
    annotations: {},
    controls: {},
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-execution-suite.test.ts',
    children: [
        benchmarkMetadataTestNode,
        collectedLifecycleTestNode,
        durationHistoryTestNode,
        supervisedRunTestNode,
        workerPoolTestNode
    ]
});

await runIfMain(import.meta, testNode);
