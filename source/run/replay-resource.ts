import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import type { AnyResourceDefinition } from '../resources/resources.ts';
import { bindResourceScenarios, resolvedResourceScenarioBindings } from '../resources/resource-scenario-binding.ts';
import { assertWitnessReplaySupported, restoreResourceWitness } from '../resources/witness-replay.ts';
import { simulationWitnessOwners, type ResourceBoundaryCase } from './resource-lifecycle-boundaries.ts';
import { resourceReplayErrorMessage, resourceWrapperLifecycleError } from './resource-lifecycle-error.ts';
import { currentReplayWitness } from './replay-context.ts';

function selectedSimulationWitness(): SimulationWitnessFile | null {
    const witness = currentReplayWitness();
    return witness?.kind === 'simulation' ? witness : null;
}

export function resourceReplayWitness(
    resource: AnyResourceDefinition,
    testCase: ResourceBoundaryCase
): SimulationWitnessFile | null {
    const witness = selectedSimulationWitness();
    if (witness === null) {
        return null;
    }
    const [ owner ] = simulationWitnessOwners(testCase, witness);
    return owner?.ownerName === resource.name ? witness : null;
}
export function replayResourceDefinition(
    resource: AnyResourceDefinition,
    witness: SimulationWitnessFile | null
): AnyResourceDefinition {
    if (witness?.scenario === null || witness === null) {
        return resource;
    }
    const slot = resource.scenarios[witness.simulation.name];
    if (slot?.values.includes(witness.scenario) !== true) {
        throw new TypeError(`Simulation witness scenario is unavailable: ${witness.scenario}`);
    }
    return bindResourceScenarios(resource, {
        ...resolvedResourceScenarioBindings(resource),
        [witness.simulation.name]: witness.scenario
    });
}
export function replayOwnerDefinition(
    resource: AnyResourceDefinition,
    witness: SimulationWitnessFile | null
): AnyResourceDefinition {
    if (witness === null) {
        return resource;
    }
    try {
        assertWitnessReplaySupported(resource);
        return replayResourceDefinition(resource, witness);
    } catch (error: unknown) {
        throw resourceWrapperLifecycleError(
            resourceReplayErrorMessage('Incompatible simulation witness', error),
            error
        );
    }
}

export async function replayAcquiredResource(
    resource: AnyResourceDefinition,
    handle: unknown,
    signal: AbortSignal,
    witness: SimulationWitnessFile | null
): Promise<void> {
    if (witness !== null) {
        signal.throwIfAborted();
        await restoreResourceWitness(resource, {
            handle,
            witness,
            signal,
            seed: witness.seed === null ? null : BigInt(witness.seed)
        });
        signal.throwIfAborted();
    }
}
