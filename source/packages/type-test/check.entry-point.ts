import type { Engine, TestRoot } from '../engine/engine.entry-point.ts';
import type { RunnerResult, RunSelection } from '../run/run.entry-point.ts';
import type { TypeTestOptions } from './profile-settings.ts';
import { typeTestAdapter } from './profile.entry-point.ts';

export type TypeTestCheckRequest = TypeTestOptions & {
    readonly engine: Engine;
    readonly root: TestRoot;
    readonly selection: RunSelection;
};

export async function checkTypeTests(request: TypeTestCheckRequest): Promise<RunnerResult> {
    const { executeAdapterPlan, prepareAdapterPlan, selectTestPlan } = await import('../run/run.entry-point.ts');
    const prepared = await prepareAdapterPlan(typeTestAdapter, {
        projectConfigPath: request.projectConfigPath,
        compiler: request.compiler
    }, request.engine.createTestPlan(request.root));
    const plan = selectTestPlan(prepared.testPlan, request.selection);
    return {
        ...await executeAdapterPlan(typeTestAdapter, prepared.collect(plan), plan),
        maintenanceDiagnostics: []
    };
}
