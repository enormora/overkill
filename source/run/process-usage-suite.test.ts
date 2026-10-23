import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as processUsageTestNode } from './process-usage.test.ts';
import { testNode as runProcessUsagePolicyTestNode } from './run-process-usage-policy.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/process-usage-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        processUsageTestNode,
        runProcessUsagePolicyTestNode
    ]
});

await runIfMain(import.meta, testNode);
