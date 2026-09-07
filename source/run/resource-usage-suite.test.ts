import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as resourceUsageTestNode } from './resource-usage.test.ts';
import { testNode as runResourceUsagePolicyTestNode } from './run-resource-usage-policy.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/resource-usage-suite.test.ts',
    metadata: {},
    children: [
        resourceUsageTestNode,
        runResourceUsagePolicyTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
