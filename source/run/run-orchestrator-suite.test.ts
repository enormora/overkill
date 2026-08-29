import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as runCapabilityPolicyTestSuite } from './run-capability-policy.test.ts';
import { testSuite as runCustomEngineTestSuite } from './run-custom-engine.test.ts';
import { testSuite as runOrchestratorCoreTestSuite } from './run-orchestrator-core-suite.test.ts';
import { testSuite as runRuntimePolicyTestSuite } from './run-runtime-policy.test.ts';
import { testSuite as runReporterResolutionTestSuite } from './run-reporter-resolution.test.ts';
import { testSuite as supervisedRunResourcePolicyTestSuite } from './supervised-run-resource-policy.test.ts';
import { testSuite as supervisedRunRuntimeTestSuite } from './supervised-run-runtime.test.ts';
import { testSuite as supervisedRuntimePolicyErrorsTestSuite } from './supervised-runtime-policy-errors.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-orchestrator-suite.test.ts',
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

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
