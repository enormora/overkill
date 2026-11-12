import { profileFamilyId } from '../config/types.ts';
import type { RunnerFamilyPreparation } from './family-profile-types.ts';
import type { RunCommand } from './run-types.ts';
import { prepareProfileFamily } from './family-profile-run.ts';
import { assertTestPlanMatchesTestFamily } from './run-selection.ts';

import type { ResolvedRunInput } from './run-input-resolution.ts';

import { snapshotProfileFamily } from './family-profile-transport.ts';
import { resolveRunEngine } from './run-engine-selection.ts';
import {
    createRunTestPlanFromDirectEntrypoint,
    createRunTestPlanFromFiles,
    type RunTestPlanInput,
    type RunTestPlanCollectionSource
} from './run-test-plan.ts';

import type { RunOrchestratorDependencies } from './run-orchestrator-dependencies.ts';

export type LocalTestPlanInput = Pick<ResolvedRunInput, 'files' | 'profile' | 'projectRoot'> & {
    readonly command: RunCommand;
    readonly definitionLocationCapture: RunTestPlanInput['definitionLocationCapture'];
    readonly dependencies: RunOrchestratorDependencies;
    readonly source: RunTestPlanCollectionSource;
};
type TestPlan = RunnerFamilyPreparation['sourcePlan'];
export type LocalTestPlan = {
    readonly testPlan: TestPlan;
    readonly preparation: RunnerFamilyPreparation;
};

async function readTestPlan(
    input: LocalTestPlanInput,
    engine: RunOrchestratorDependencies['defaultEngine']
): Promise<TestPlan> {
    const policy = {
        runtimeMatrices: true,
        benchmarkCalibration: false,
        property: input.profile.testFamily === 'property'
            ? { policy: input.profile.property, timeoutMilliseconds: input.profile.timeouts.softMilliseconds }
            : null
    } as const;

    if (input.source.kind === 'direct-entrypoint') {
        const [ file ] = input.files;

        return createRunTestPlanFromDirectEntrypoint(engine, file, input.source, policy);
    }

    return await createRunTestPlanFromFiles({
        cwd: input.command.cwd,
        definitionLocationCapture: input.definitionLocationCapture,
        engine,
        files: input.files,
        loadRunTestModules: input.dependencies.loadRunTestModules,
        root: { annotations: {}, controls: {}, title: input.command.cwd },
        testFamily: profileFamilyId(input.profile)
    }, policy);
}

export async function createProfileTestPlan(input: LocalTestPlanInput, signal: AbortSignal): Promise<LocalTestPlan> {
    const engine = await resolveRunEngine(input.command.engine, input.dependencies);
    const collected = await readTestPlan(input, engine);
    assertTestPlanMatchesTestFamily(collected, profileFamilyId(input.profile));
    const definition = snapshotProfileFamily({
        profile: input.profile,
        source: input.source,
        profileName: input.command.request.profile,
        projectRoot: input.projectRoot,
        definitionLocationCapture: input.definitionLocationCapture
    });
    const preparation = await prepareProfileFamily(engine, collected, input.profile, {
        projectRoot: input.projectRoot,
        signal
    });
    return { testPlan: preparation.prepared.testPlan, preparation: { ...preparation, definition } };
}
