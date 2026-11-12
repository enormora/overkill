import type { Engine } from '../engine/engine.ts';
import { isBuiltinFamilyId } from '../engine/builtin-test-families.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import type { TestPlanCollectionPolicy } from '../engine/plan-collection-policy.ts';
import { defaultRunEngine, calibrationCapturePlan } from './default-run-engine.ts';
import { registerHostFamilyPlan } from './host-family-plan.ts';
import { resolveTestPlanCollectionPolicy } from './run-selection.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

type HostPlanCommand = Pick<
    SupervisedChildCommand,
    'benchmarkNormalization' | 'cwd' | 'propertyPolicy' | 'replay' | 'testFamily' | 'timeoutMilliseconds'
>;
type HostPlanInput = {
    readonly command: HostPlanCommand;
    readonly engine: Engine;
    readonly collect: (policy: TestPlanCollectionPolicy) => Promise<TestPlan>;
};

export async function resolveHostEngine(
    selection: SupervisedChildCommand['engine'],
    load: RunEngineModuleLoader
): Promise<Engine> {
    return selection.kind === 'module' ? await load(selection) : defaultRunEngine;
}

function hostCollectionPolicy(command: HostPlanCommand): TestPlanCollectionPolicy {
    return {
        runtimeMatrices: true,
        benchmarkCalibration: command.benchmarkNormalization?.mode === 'capture',
        property: command.testFamily === 'property' && command.propertyPolicy !== null
            ? { policy: command.propertyPolicy, timeoutMilliseconds: command.timeoutMilliseconds }
            : null
    };
}

export async function createHostTestPlan(input: HostPlanInput): Promise<TestPlan> {
    const plan = await input.collect(hostCollectionPolicy(input.command));
    if (input.command.replay?.kind === 'record') {
        return calibrationCapturePlan(
            resolveTestPlanCollectionPolicy(plan, input.command),
            input.command.benchmarkNormalization
        );
    }
    if (!isBuiltinFamilyId(input.command.testFamily)) {
        throw new TypeError('Imported families require explicit host resolution.');
    }
    return registerHostFamilyPlan(plan, input.engine, input.command.testFamily, input.command.cwd);
}
