import { suite } from '@overkill-dev/test';

import { testNode as commandLineRunnerTestNode } from './command-line-runner-suite.test.ts';
import { testNode as processUsageTestNode } from './process-usage-suite.test.ts';
import { testNode as runConfigurationTestNode } from './run-configuration-suite.test.ts';
import { testNode as runListRendererTestNode } from './run-list-renderer.test.ts';
import { testNode as runOrchestratorTestNode } from './run-orchestrator-suite.test.ts';
import { testNode as runPlanningTestNode } from './run-planning-suite.test.ts';
import { testNode as runIfMainTestNode } from './run-if-main-suite.test.ts';
import { testNode as runExecutionTestNode } from './run-execution-suite.test.ts';

export const testNode = suite('source/run/run-suite.test.ts', [
    commandLineRunnerTestNode,
    processUsageTestNode,
    runConfigurationTestNode,
    runIfMainTestNode,
    runListRendererTestNode,
    runOrchestratorTestNode,
    runPlanningTestNode,
    runExecutionTestNode
]);
