import type { WorkloadId } from '../engine/identity.ts';
import type { WorkloadInput, WorkloadParameters } from '../engine/workload-input.ts';

export type ResourceWorkload<Parameters extends WorkloadParameters> = {
    readonly id: WorkloadId;
    readonly parameters: Parameters;
};

export type ResourceWorkloadParser<Parameters extends WorkloadParameters> = (
    parameters: WorkloadParameters
) => Parameters;

export function hasWorkloadInput<Value extends Record<string, unknown>>(
    value: Value
): value is Value & { readonly workload: WorkloadInput; } {
    return Object.hasOwn(value, 'workload');
}
