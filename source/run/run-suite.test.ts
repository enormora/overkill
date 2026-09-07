import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commandLineRunnerTestNode } from './command-line-runner-suite.test.ts';
import { testNode as resourceUsageTestNode } from './resource-usage-suite.test.ts';
import { testNode as runConfigurationTestNode } from './run-configuration-suite.test.ts';
import { testNode as runListRendererTestNode } from './run-list-renderer.test.ts';
import { testNode as runOrchestratorTestNode } from './run-orchestrator-suite.test.ts';
import { testNode as runPlanningTestNode } from './run-planning-suite.test.ts';
import { testNode as runIfMainTestNode } from './run-if-main-suite.test.ts';
import { testNode as supervisedRunTestNode } from './supervised-run.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { column: null, file: '', line: null } ],
    title: 'source/run/run-suite.test.ts',
    metadata: {},
    children: [
        commandLineRunnerTestNode,
        resourceUsageTestNode,
        runConfigurationTestNode,
        runIfMainTestNode,
        runListRendererTestNode,
        runOrchestratorTestNode,
        runPlanningTestNode,
        supervisedRunTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('../test-support/run-if-main.ts');

await runTestFileIfMain(import.meta, testNode);
