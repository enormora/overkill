import type { Engine, TestRoot } from '../engine/engine.entry-point.ts';
import type { RunnerResult, RunRequest } from '../run/run.entry-point.ts';
import type { TypeTestOptions } from './profile-settings.ts';
import { typeTestAdapter } from './profile.entry-point.ts';

export type TypeTestCheckRequest = TypeTestOptions & {
    readonly engine: Engine;
    readonly root: TestRoot;
    readonly selection: RunRequest['selection'];
    readonly order: RunRequest['order'];
    readonly seed: RunRequest['seed'];
    readonly shard: RunRequest['shard'];
};

export async function checkTypeTests(request: TypeTestCheckRequest): Promise<RunnerResult> {
    const { executeAdapterPlan, prepareAdapterPlan, planTestSelection, expandTestPlanRuntimes, parseRunSelection } =
        await import('../run/run.entry-point.ts');
    parseRunSelection(request.selection);
    const prepared = await prepareAdapterPlan(typeTestAdapter, {
        projectConfigPath: request.projectConfigPath,
        compiler: request.compiler
    }, expandTestPlanRuntimes(request.engine.createTestPlan(request.root)));
    const selection = await planTestSelection(prepared.testPlan, request);
    if (selection.kind === 'empty-shard') {
        return { ...selection.result, maintenanceDiagnostics: [] };
    }
    const plan = selection.testPlan;
    return {
        ...await executeAdapterPlan(typeTestAdapter, prepared.collect(plan), plan),
        maintenanceDiagnostics: []
    };
}
