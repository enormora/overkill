import { createLineReporter as createOverkillLineReporter } from '@overkill-dev/reporter-line';
import { createSuite as createOverkillSuite, runIfMain } from '@overkill-dev/engine';
import { testSuite as commandLineRunnerTestSuite } from './command-line-runner-suite.test.ts';
import { testSuite as resourceUsageTestSuite } from './resource-usage-suite.test.ts';
import { testSuite as runConfigurationTestSuite } from './run-configuration-suite.test.ts';
import { testSuite as runListRendererTestSuite } from './run-list-renderer.test.ts';
import { testSuite as runOrchestratorTestSuite } from './run-orchestrator-suite.test.ts';
import { testSuite as runPlanningTestSuite } from './run-planning-suite.test.ts';
import { testSuite as supervisedRunTestSuite } from './supervised-run.test.ts';

export const testSuite = createOverkillSuite({
    name: 'source/run/run-suite.test.ts',
    metadata: {},
    children: [
        commandLineRunnerTestSuite,
        resourceUsageTestSuite,
        runConfigurationTestSuite,
        runListRendererTestSuite,
        runOrchestratorTestSuite,
        runPlanningTestSuite,
        supervisedRunTestSuite
    ]
});

await runIfMain(import.meta, testSuite, { reporters: [ createOverkillLineReporter() ] });
