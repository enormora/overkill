import { declareImplementations } from '../engine/body-reference-plan.ts';
import type { Engine, TestPlan, TestPlanCollectionPolicy, FamilyValue, WorkId } from '../packages/engine/engine.entry-point.ts';
import { bindWireReplayPlan } from './replay-wire.ts';
import type { ReplayWire } from './run-types.ts';
import { defaultRunEngine, calibrationCapturePlan } from './default-run-engine.ts';
import { collectRetainedHostAnalysis, transferHostFamilyPlan, registerImportedHostFamilyPlan, registerHostFamilyPlan } from './host-family-plan.ts';
import { resolveTestPlanCollectionPolicy, assertTestPlanCollectionPolicy } from './run-selection.ts';
import type { RunEngineModuleLoader } from './run-engine-selection.ts';
import type { SupervisedChildCommand } from './supervised-protocol.ts';

import { withAnalysisDeadline, withAnalysisSignal } from './analysis-deadline.ts';

export async function collectHostAnalysis(
    plan: TestPlan,
    workIds: readonly WorkId[],
    timeoutMilliseconds: number
): Promise<FamilyValue> {
    return await withAnalysisDeadline(timeoutMilliseconds, 'Selected analysis exceeded collection timeout.', async function collect(signal) {
        return await withAnalysisSignal(signal, async function collectRetained() {
            return await collectRetainedHostAnalysis(plan, workIds);
        });
    });
}

type HostFamilyFields = 'family' | 'implementationContext' | 'implementations' | 'testFamily';
type HostPolicyFields = 'benchmarkNormalization' | 'propertyPolicy' | 'replay' | 'timeoutMilliseconds';
type HostPlanCommand = Pick<SupervisedChildCommand, HostFamilyFields | HostPolicyFields | 'cwd'>;
type HostPlanInput = {
    readonly processModel: 'supervised-process' | 'worker-pool';
    readonly command: HostPlanCommand;
    readonly engine: Engine;
    readonly collect: (policy: TestPlanCollectionPolicy, replay: ReplayWire | null) => Promise<TestPlan>;
};

export type HostEngineLoading = { readonly loadRunEngineModule: RunEngineModuleLoader; };

export async function resolveHostEngine(
    selection: SupervisedChildCommand['engine'],
    dependencies: HostEngineLoading
): Promise<Engine> {
    return selection.kind === 'module' ? await dependencies.loadRunEngineModule(selection) : defaultRunEngine;
}

function hostCollectionPolicy(command: HostPlanCommand): TestPlanCollectionPolicy {
    return {
        runtimeMatrices: true,
        benchmarkCalibration: command.benchmarkNormalization?.mode === 'capture',
        property: command.propertyPolicy === null ? null : {
            testFamily: command.testFamily === 'integration' ? 'integration' : 'property',
            policy: command.propertyPolicy,
            timeoutMilliseconds: command.timeoutMilliseconds
        }
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
    const source = await input.collect(hostCollectionPolicy(input.command), input.command.replay);
    const { signal } = new AbortController();
    const plan = await declareImplementations(
        source,
        input.command.implementationContext,
        signal
    );
    if (input.command.replay?.kind === 'record') {
        return calibrationCapturePlan(
            resolveTestPlanCollectionPolicy(plan, input.command),
            input.command.benchmarkNormalization
        );
    }
    assertTestPlanCollectionPolicy(plan, input.command);
    registerHostFamilyPlan(
        source,
        input.engine,
        input.command.testFamily,
        input.command.implementationContext.projectRoot
    );
    return transferHostFamilyPlan(source, plan);
}
