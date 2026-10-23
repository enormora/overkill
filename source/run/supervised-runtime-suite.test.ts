import { runIfMain } from '#test-runner';
import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as processPolicyTestNode } from './process-policy-suite.test.ts';
import { testNode as supervisedChildSuiteTestNode } from './supervised-child-suite.test.ts';
import { testNode as supervisedRunProcessPolicyTestNode } from './supervised-run-process-policy.test.ts';
import { testNode as supervisedRunRuntimeTestNode } from './supervised-run-runtime.test.ts';
import { testNode as supervisedRuntimePolicyErrorsTestNode } from './supervised-runtime-policy-errors.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/supervised-runtime-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        processPolicyTestNode,
        supervisedChildSuiteTestNode,
        supervisedRunProcessPolicyTestNode,
        supervisedRunRuntimeTestNode,
        supervisedRuntimePolicyErrorsTestNode
    ]
});

await runIfMain(import.meta, testNode);
