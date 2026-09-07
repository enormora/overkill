import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as runCapabilityPolicyTestNode } from './run-capability-policy.test.ts';
import { testNode as runCustomEngineTestNode } from './run-custom-engine.test.ts';
import { testNode as runOrchestratorCoreTestNode } from './run-orchestrator-core-suite.test.ts';
import { testNode as runRuntimePolicyTestNode } from './run-runtime-policy.test.ts';
import { testNode as runReporterResolutionTestNode } from './run-reporter-resolution.test.ts';
import { testNode as supervisedRunResourcePolicyTestNode } from './supervised-run-resource-policy.test.ts';
import { testNode as supervisedRunRuntimeTestNode } from './supervised-run-runtime.test.ts';
import { testNode as supervisedRuntimePolicyErrorsTestNode } from './supervised-runtime-policy-errors.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-orchestrator-suite.test.ts',
    metadata: {},
    children: [
        runCapabilityPolicyTestNode,
        runCustomEngineTestNode,
        runOrchestratorCoreTestNode,
        runReporterResolutionTestNode,
        runRuntimePolicyTestNode,
        supervisedRunResourcePolicyTestNode,
        supervisedRunRuntimeTestNode,
        supervisedRuntimePolicyErrorsTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
