import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import type { AnyResourceDefinition } from '../resources/resources.ts';
import { bindResourceScenarios, acquisitionResourceScenarioBindings } from '../resources/resource-scenario-binding.ts';
import { restoreResourceWitness } from '../resources/witness-replay.ts';
import { currentReplayWitness } from './replay-context.ts';

function selectedSimulationWitness(): SimulationWitnessFile | null {
    const witness = currentReplayWitness();
    return witness?.kind === 'simulation' ? witness : null;
}
function simulationWitness(resource: AnyResourceDefinition): SimulationWitnessFile | null {
    const witness = selectedSimulationWitness();
    if (witness === null) {
        return null;
    }
    return (witness.resource?.name ?? witness.simulation.name) === resource.name ? witness : null;
}
export function replayResourceDefinition(resource: AnyResourceDefinition): AnyResourceDefinition {
    const witness = simulationWitness(resource);
    if (witness?.scenario === null || witness === null) {
        return resource;
    }
    const slot = resource.scenarios[witness.simulation.name];
    if (slot?.values.includes(witness.scenario) !== true) {
        throw new TypeError(`Simulation witness scenario is unavailable: ${witness.scenario}`);
    }
    return bindResourceScenarios(resource, {
        ...acquisitionResourceScenarioBindings(resource),
        [witness.simulation.name]: witness.scenario
    });
}
export async function replayAcquiredResource(
    resource: AnyResourceDefinition,
    handle: unknown,
    signal: AbortSignal
): Promise<void> {
    const witness = simulationWitness(resource);
    if (witness !== null) {
        await restoreResourceWitness(resource, {
            handle,
            witness,
            signal,
            seed: witness.seed === null ? null : BigInt(witness.seed)
        });
    }
}
