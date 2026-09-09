import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as resourceUsageTestNode } from './resource-usage.test.ts';
import { testNode as runResourceUsagePolicyTestNode } from './run-resource-usage-policy.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/resource-usage-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        resourceUsageTestNode,
        runResourceUsagePolicyTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
