import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as runCapabilityPolicyTestSuite } from './run-capability-policy.test.ts';
import { testSuite as runTestSuite } from './run.test.ts';
import { testSuite as supervisedRuntimePolicyErrorsTestSuite } from './supervised-runtime-policy-errors.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-orchestrator-suite.test.ts',
    metadata: {},
    children: [
        runCapabilityPolicyTestSuite,
        runTestSuite,
        supervisedRuntimePolicyErrorsTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
