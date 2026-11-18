import { hasBodyImplementations } from '../engine/body-reference-plan.ts';
import type { BodyPlanLease, startBodyPlanLease } from '../engine/body-reference-lifetime.ts';
import type { TestPlan } from '../engine/test-plan.ts';

export type WorkerImplementationLifetime = {
    readonly run: <Value>(key: string, operation: () => Promise<Value>) => Promise<Value>;
    readonly with: <Value>(
        key: string,
        plan: TestPlan,
        operation: (resolved: TestPlan) => Promise<Value>
    ) => Promise<Value>;
    readonly close: (key: string) => Promise<void>;
};
export function createWorkerImplementationLifetime(
    startLease: typeof startBodyPlanLease
): WorkerImplementationLifetime {
    const implementationLeases = new Map<string, BodyPlanLease[]>();
    function freshSignal(): AbortSignal {
        const { signal } = new AbortController();
        return signal;
    }
    async function runWithWorkerImplementations<Value>(
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
            throw new AggregateError([ failure, error ], 'Implementation execution and cleanup failed.', {
                cause: error
            });
        }
        throw failure;
    }
    async function withWorkerImplementations<Value>(
        key: string,
        plan: TestPlan,
        operation: (resolved: TestPlan) => Promise<Value>
    ): Promise<Value> {
        if (!hasBodyImplementations(plan)) {
            return await runWithWorkerImplementations(key, async function executeInline() {
                return await operation(plan);
            });
        }
        const lease = await startLease(plan, freshSignal());
        implementationLeases.set(key, [ ...implementationLeases.get(key) ?? [], lease ]);
        try {
            return await runWithWorkerImplementations(key, async function execute() {
                return await operation(lease.plan);
            });
        } catch (error: unknown) {
            return await closeFailedImplementation(key, lease, error);
        }
    }
    async function closeWorkerImplementations(key: string): Promise<void> {
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

    return { run: runWithWorkerImplementations, with: withWorkerImplementations, close: closeWorkerImplementations };
}
