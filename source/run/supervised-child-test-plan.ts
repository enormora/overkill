import type { Engine } from '../engine/engine.ts';
import type { TestPlan } from '../packages/engine/engine.entry-point.ts';
import { defaultRunEngine } from './default-run-engine.ts';
import { loadRunEngineModule } from './run-engine-selection.ts';
import { createRunTestPlan } from './run-test-plan.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

async function selectedEngine(command: SupervisedChildCommand): Promise<Engine> {
    return command.engine.kind === 'module' ? await loadRunEngineModule(command.engine) : defaultRunEngine;
}

export async function createSupervisedChildTestPlan(command: SupervisedChildCommand): Promise<TestPlan> {
    const engine = await selectedEngine(command);

    return await createRunTestPlan({
        cwd: command.cwd,
        engine,
        paths: command.paths,
        testFamily: command.testFamily
    });
}
