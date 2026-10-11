import type { WorkloadId } from './identity.ts';

export function workloadLabel(workload: WorkloadId | null): string {
    return workload === null ? '' : ` [workload=${workload.name}]`;
}
