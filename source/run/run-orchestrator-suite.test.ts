import { suite } from '@overkill-dev/test';

import { testNode as runOrchestratorCoreTestNode } from './run-orchestrator-core-suite.test.ts';
import { testNode as runtimePolicyTestNode } from './run-runtime-policy-suite.test.ts';
import { testNode as runReporterResolutionTestNode } from './run-reporter-resolution.test.ts';
import { testNode as runTimingCollectionTestNode } from './run-timing-collection.test.ts';
import { testNode as supervisedRuntimeSuiteTestNode } from './supervised-runtime-suite.test.ts';

export const testNode = suite('source/run/run-orchestrator-suite.test.ts', [
    runOrchestratorCoreTestNode,
    runReporterResolutionTestNode,
    runtimePolicyTestNode,
    runTimingCollectionTestNode,
    supervisedRuntimeSuiteTestNode
]);
