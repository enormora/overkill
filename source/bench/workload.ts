import type { ReadonlyDeep } from 'type-fest';
import { canonicalIdentityJson } from '../canonical-identity.ts';
import type { WorkloadId } from '../engine/identity.ts';
import { snapshotWorkloadParameters, type WorkloadParameters } from './workload-parameters.ts';

const workloadBrand = Symbol.for('@overkill-dev/bench/Workload');

export type Workload<Name extends string, Parameters extends WorkloadParameters> = {
    readonly [workloadBrand]: true;
    readonly id: WorkloadId;
    readonly name: Name;
    readonly parameters: ReadonlyDeep<Parameters>;
};

function parameterIdentity(parameters: WorkloadParameters): WorkloadId['params'] {
    return Object.freeze(Object.fromEntries(
        Object
            .entries(parameters)
            .map(function encodeParameter([ key, value ]): readonly [string, string] {
                return [ key.normalize('NFC'), canonicalIdentityJson(value) ];
            })
            .toSorted(function compareNames([ left ], [ right ]) {
                return left.localeCompare(right);
            })
    ));
}

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
        id: Object.freeze({ name, params: parameterIdentity(snapshot) }),
        name,
        parameters: snapshot
    };
    return Object.freeze(result);
}
