import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as supervisedChildSuiteTestNode } from './supervised-child-suite.test.ts';
import { testNode as supervisedRunResourcePolicyTestNode } from './supervised-run-resource-policy.test.ts';
import { testNode as supervisedRunRuntimeTestNode } from './supervised-run-runtime.test.ts';
import { testNode as supervisedRuntimePolicyErrorsTestNode } from './supervised-runtime-policy-errors.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-runtime-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        supervisedChildSuiteTestNode,
        supervisedRunResourcePolicyTestNode,
        supervisedRunRuntimeTestNode,
        supervisedRuntimePolicyErrorsTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
