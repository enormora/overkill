import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testSuite as runCapabilityPolicyTestSuite } from './run-capability-policy.test.ts';
import { testSuite as runCustomEngineTestSuite } from './run-custom-engine.test.ts';
import { testSuite as runOrchestratorCoreTestSuite } from './run-orchestrator-core-suite.test.ts';
import { testSuite as runRuntimePolicyTestSuite } from './run-runtime-policy.test.ts';
import { testSuite as runReporterResolutionTestSuite } from './run-reporter-resolution.test.ts';
import { testSuite as supervisedRunResourcePolicyTestSuite } from './supervised-run-resource-policy.test.ts';
import { testSuite as supervisedRunRuntimeTestSuite } from './supervised-run-runtime.test.ts';
import { testSuite as supervisedRuntimePolicyErrorsTestSuite } from './supervised-runtime-policy-errors.test.ts';

export const testSuite = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-orchestrator-suite.test.ts',
    metadata: {},
    children: [
        runCapabilityPolicyTestSuite,
        runCustomEngineTestSuite,
        runOrchestratorCoreTestSuite,
        runReporterResolutionTestSuite,
        runRuntimePolicyTestSuite,
        supervisedRunResourcePolicyTestSuite,
        supervisedRunRuntimeTestSuite,
        supervisedRuntimePolicyErrorsTestSuite
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testSuite);
