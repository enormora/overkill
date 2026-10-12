import type { ReadonlyDeep } from 'type-fest';
import type { WorkloadId } from '../engine/identity.ts';
import { workloadParameterIdentity } from '../engine/workload-input.ts';
import { snapshotWorkloadParameters, type WorkloadParameters } from '../engine/workload-parameters.ts';

const workloadBrand = Symbol.for('@overkill-dev/bench/Workload');

export type Workload<Name extends string, Parameters extends WorkloadParameters> = {
    readonly [workloadBrand]: true;
    readonly id: WorkloadId;
    readonly name: Name;
    readonly parameters: ReadonlyDeep<Parameters>;
};

export function workload<const Name extends string, const Parameters extends WorkloadParameters>(
    name: Name,
    parameters: Parameters
): Workload<Name, Parameters>;
export function workload(name: string, parameters: unknown): Workload<string, WorkloadParameters> {
    if (typeof name !== 'string' || name.trim().length === 0 || /\p{Cc}/v.test(name)) {
        throw new TypeError('Workload names must be non-empty strings without control characters.');
    }
    const snapshot = snapshotWorkloadParameters(parameters);
    const result: Workload<string, WorkloadParameters> = {
        [workloadBrand]: true,
        id: Object.freeze({ name, params: workloadParameterIdentity(snapshot) }),
        name,
        parameters: snapshot
    };
    return Object.freeze(result);
}
