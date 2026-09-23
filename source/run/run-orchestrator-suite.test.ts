import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as permissionDenialRuntimePolicyTestNode } from './permission-denial-runtime-policy.test.ts';
import { testNode as runCapabilityPolicyTestNode } from './run-capability-policy.test.ts';
import { testNode as runCustomEngineTestNode } from './run-custom-engine.test.ts';
import { testNode as runOrchestratorCoreTestNode } from './run-orchestrator-core-suite.test.ts';
import { testNode as runRuntimePolicyTestNode } from './run-runtime-policy.test.ts';
import { testNode as runReporterResolutionTestNode } from './run-reporter-resolution.test.ts';
import { testNode as runTimingCollectionTestNode } from './run-timing-collection.test.ts';
import { testNode as supervisedRuntimeSuiteTestNode } from './supervised-runtime-suite.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-orchestrator-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        permissionDenialRuntimePolicyTestNode,
        runCapabilityPolicyTestNode,
        runCustomEngineTestNode,
        runOrchestratorCoreTestNode,
        runReporterResolutionTestNode,
        runRuntimePolicyTestNode,
        runTimingCollectionTestNode,
        supervisedRuntimeSuiteTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
