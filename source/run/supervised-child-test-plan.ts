import type { Engine } from '../engine/engine.ts';
import type { TestPlan } from '../packages/engine/engine.entry-point.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { createRunTestPlan } from './run-test-plan.ts';
import type { RunDiscovery } from './run-discovery-types.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import { assertTestPlanMatchesTestFamily } from './run-selection.ts';
import type { RunTestModuleLoader } from './run-test-modules.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

export type SupervisedChildTestPlanDependencies = {
    readonly discoverRunFiles: RunDiscovery['discoverRunFiles'];
    readonly loadRunEngineModule: RunEngineModuleLoader;
    readonly loadRunTestModules: RunTestModuleLoader;
};

async function selectedEngine(
    command: SupervisedChildCommand,
    dependencies: SupervisedChildTestPlanDependencies
): Promise<Engine> {
    return command.engine.kind === 'module' ? await dependencies.loadRunEngineModule(command.engine) : defaultRunEngine;
}

export async function createSupervisedChildTestPlan(
    command: SupervisedChildCommand,
    dependencies: SupervisedChildTestPlanDependencies
): Promise<TestPlan> {
    const engine = await selectedEngine(command, dependencies);
    const testPlan = await createRunTestPlan({
        cwd: command.cwd,
        discoverRunFiles: dependencies.discoverRunFiles,
        engine,
        loadRunTestModules: dependencies.loadRunTestModules,
        paths: command.paths,
        testFamily: command.testFamily
    });

    assertTestPlanMatchesTestFamily(testPlan, command.testFamily);

    return testPlan;
}
