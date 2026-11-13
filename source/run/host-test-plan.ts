import type { Engine, TestPlan, TestPlanCollectionPolicy } from '../packages/engine/engine.entry-point.ts';
import { isBuiltinFamilyId } from '../engine/builtin-test-families.ts';
import { bindWireReplayPlan } from './replay-wire.ts';
import type { ReplayWire } from './run-types.ts';
import { defaultRunEngine, calibrationCapturePlan } from './default-run-engine.ts';
import { transferHostFamilyPlan, registerImportedHostFamilyPlan, registerHostFamilyPlan } from './host-family-plan.ts';
import { resolveTestPlanCollectionPolicy } from './run-selection.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

type HostPlanCommand = Pick<
    SupervisedChildCommand,
    'benchmarkNormalization' | 'cwd' | 'family' | 'propertyPolicy' | 'replay' | 'testFamily' | 'timeoutMilliseconds'
>;
type HostPlanInput = {
    readonly processModel: 'supervised-process' | 'worker-pool';
    readonly command: HostPlanCommand;
    readonly engine: Engine;
    readonly collect: (policy: TestPlanCollectionPolicy, replay: ReplayWire | null) => Promise<TestPlan>;
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

function allowsFreshReplayHost(
    input: HostPlanInput,
    processModel: string,
    replay: ReplayWire | null
): boolean {
    return input.processModel === 'supervised-process' && processModel === 'in-process' && replay?.kind === 'record';
}

function validateFamilyHostCommand(input: HostPlanInput): void {
    const { family, testFamily, replay } = input.command;
    if (family?.id !== testFamily) {
        throw new TypeError('Frozen family command identity is inconsistent.');
    }
    if (family.processModel === input.processModel) {
        return;
    }
    if (
        allowsFreshReplayHost(input, family.processModel, replay)
    ) {
        return;
    }
    throw new TypeError('Frozen family placement is inconsistent.');
}

async function createImportedHostTestPlan(input: HostPlanInput): Promise<TestPlan> {
    validateFamilyHostCommand(input);
    const definition = input.command.family;
    if (definition === null) {
        throw new TypeError('Imported family definition is unavailable.');
    }
    const { loadFrozenFamily } = await import('./node-family-resolution.ts');
    const binding = await loadFrozenFamily(definition, input.command.cwd);
    const plan = await input.collect(hostCollectionPolicy(input.command), null);
    const prepared = await registerImportedHostFamilyPlan(plan, input.engine, binding, definition);
    return transferHostFamilyPlan(prepared, bindWireReplayPlan(prepared, input.command.replay));
}

export async function createHostTestPlan(input: HostPlanInput): Promise<TestPlan> {
    if (input.command.family !== null) {
        return await createImportedHostTestPlan(input);
    }
    const plan = await input.collect(hostCollectionPolicy(input.command), input.command.replay);
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
