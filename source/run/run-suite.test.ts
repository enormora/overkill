import { createSuite as createOverkillSuite } from '../packages/engine/engine.entry-point.ts';
import { testNode as commandLineRunnerTestNode } from './command-line-runner-suite.test.ts';
import { testNode as processUsageTestNode } from './process-usage-suite.test.ts';
import { testNode as runConfigurationTestNode } from './run-configuration-suite.test.ts';
import { testNode as runListRendererTestNode } from './run-list-renderer.test.ts';
import { testNode as runOrchestratorTestNode } from './run-orchestrator-suite.test.ts';
import { testNode as runPlanningTestNode } from './run-planning-suite.test.ts';
import { testNode as runIfMainTestNode } from './run-if-main-suite.test.ts';
import { testNode as runExecutionTestNode } from './run-execution-suite.test.ts';

export const testNode = createOverkillSuite({
    definitionLocations: [ { kind: 'unknown' as const } ],
    title: 'source/run/run-suite.test.ts',
    annotations: {},
    controls: {},
    children: [
        commandLineRunnerTestNode,
        processUsageTestNode,
        runConfigurationTestNode,
        runIfMainTestNode,
        runListRendererTestNode,
        runOrchestratorTestNode,
        runPlanningTestNode,
        runExecutionTestNode
    ]
});

const { runIfMain: runTestFileIfMain } = await import('#test-runner');

await runTestFileIfMain(import.meta, testNode);
