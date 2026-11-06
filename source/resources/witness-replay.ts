import type { SimulationWitnessFile } from '../engine/witness-file.ts';
import type { AnyResourceDefinition, Awaitable } from './resource-definition-shape.ts';

type ReplayResource = Pick<AnyResourceDefinition, 'acquire'>;
export type ResourceWitnessReplay<Resource extends ReplayResource> = {
    readonly handle: Awaited<ReturnType<Resource['acquire']>>;
    readonly witness: SimulationWitnessFile;
    readonly seed: bigint | null;
    readonly signal: AbortSignal;
};
const restoreKey = Symbol.for('@overkill-dev/resource-witness-replay/v1');

export function withWitnessReplay<Resource extends ReplayResource>(
    resource: Resource,
    restore: (context: ResourceWitnessReplay<Resource>) => Awaitable<void>
): Resource {
    if (Reflect.has(resource, restoreKey)) {
        throw new TypeError('A resource may declare only one witness replay callback.');
    }
    return Object.freeze({ ...resource, [restoreKey]: restore });
}

export async function restoreResourceWitness(
    resource: AnyResourceDefinition,
    context: ResourceWitnessReplay<{ readonly acquire: () => unknown; }>
): Promise<void> {
    const restore: unknown = Reflect.get(resource, restoreKey);
    if (typeof restore !== 'function') {
        throw new TypeError(`Resource "${resource.name}" does not support simulation witness replay.`);
    }
    await Reflect.apply(restore, undefined, [ context ]);
}
