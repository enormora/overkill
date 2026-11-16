import { hasBodyImplementations, withImplementationPlan } from '../engine/body-reference-plan.ts';
import { startBodyPlanLease, type BodyPlanLease } from '../engine/body-reference-lifetime.ts';
import { workIdentityKey } from '../engine/identity.ts';
import type { TestPlan } from '../engine/test-plan.ts';
import { caseResourceOwnershipBoundaries } from './resource-lifecycle-boundaries.ts';
import type { WorkerPoolRunTask, WorkerPoolAcquireRunResourcesTask } from './worker-pool-protocol.ts';

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

const implementationLeases = new Map<string, BodyPlanLease[]>();
function freshSignal(): AbortSignal {
    const { signal } = new AbortController();
    return signal;
}
export async function runWithWorkerImplementations<Value>(
    key: string,
    operation: () => Promise<Value>
): Promise<Value> {
    const leases = implementationLeases.get(key) ?? [];
    async function run(index: number): Promise<Value> {
        const lease = leases[index];
        return lease === undefined ? await operation() : await lease.run(async function next() {
            return await run(index + 1);
        });
    }
    return await run(0);
}
async function closeFailedImplementation(key: string, lease: BodyPlanLease, failure: unknown): Promise<never> {
    const remaining = (implementationLeases.get(key) ?? []).filter(function retained(current) {
        return current !== lease;
    });
    if (remaining.length === 0) {
        implementationLeases.delete(key);
    } else {
        implementationLeases.set(key, remaining);
    }
    try {
        await lease.close();
    } catch (error: unknown) {
        throw new AggregateError([ failure, error ], 'Implementation execution and cleanup failed.', { cause: error });
    }
    throw failure;
}
export async function withWorkerImplementations<Value>(
    key: string,
    plan: TestPlan,
    operation: (resolved: TestPlan) => Promise<Value>
): Promise<Value> {
    if (!hasBodyImplementations(plan)) {
        return await runWithWorkerImplementations(key, async function executeInline() {
            return await operation(plan);
        });
    }
    const lease = await startBodyPlanLease(plan, freshSignal());
    implementationLeases.set(key, [ ...implementationLeases.get(key) ?? [], lease ]);
    try {
        return await runWithWorkerImplementations(key, async function execute() {
            return await operation(lease.plan);
        });
    } catch (error: unknown) {
        return await closeFailedImplementation(key, lease, error);
    }
}
export async function closeWorkerImplementations(key: string): Promise<void> {
    const leases = implementationLeases.get(key) ?? [];
    implementationLeases.delete(key);
    const failures: unknown[] = [];
    for (const lease of leases.toReversed()) {
        try {
            await lease.close();
        } catch (error: unknown) {
            failures.push(error);
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures, 'Implementation cleanup failed.');
    }
}
