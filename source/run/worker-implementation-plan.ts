import { withImplementationPlan } from '../engine/body-reference-plan.ts';
import { startBodyPlanLease } from '../engine/body-reference-lifetime.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { createWorkerImplementationLifetime } from './worker-implementation-lifetime.ts';
import { caseResourceOwnershipBoundaries } from './resource-lifecycle-boundaries.ts';
import type {
    WorkerRunTask as WorkerPoolRunTask,
    WorkerResourceTask as WorkerPoolAcquireRunResourcesTask
} from './worker-pool-protocol.ts';

export function workerImplementationPlan(
    plan: TestPlan,
    task: WorkerPoolAcquireRunResourcesTask | WorkerPoolRunTask
): TestPlan {
    const boundaryKeys = new Set(
        task.kind === 'run'
            ? task.projectedResources.resources.map(function key(record) {
                return record.boundaryKey;
            })
            : task.boundaryKeys
    );
    const ownerKeys = plan.cases.flatMap(function owned(testCase) {
        return caseResourceOwnershipBoundaries(testCase)
            .filter(function local(boundary) {
                return task.kind === 'run' ? !boundaryKeys.has(boundary.key) : boundaryKeys.has(boundary.key);
            })
            .map(function key(boundary) {
                return `${workIdentityKey(testCase.workId)}:resource-owner:${boundary.scope}:${boundary.resourceName}`;
            });
    });
    return withImplementationPlan(plan, {
        catalog: task.command.implementations,
        admission: { body: task.kind === 'run', ownerKeys }
    });
}

const implementationLifetime = createWorkerImplementationLifetime(startBodyPlanLease);
export const runWithWorkerImplementations = implementationLifetime.run;
export const withWorkerImplementations = implementationLifetime.with;
export const closeWorkerImplementations = implementationLifetime.close;
