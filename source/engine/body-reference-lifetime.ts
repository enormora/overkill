import { withImplementationActivations, type ImplementationActivation } from '../implementation-participant.ts';
import { withBodyPlanAdmission } from './body-reference-plan.ts';
import type { TestPlan } from './test-plan.ts';

export type BodyPlanLease = {
    readonly plan: TestPlan;
    readonly run: <Value>(operation: () => Promise<Value>) => Promise<Value>;
    readonly close: () => Promise<void>;
};
type BodyReadiness = { readonly plan: TestPlan; readonly activations: readonly ImplementationActivation[]; };
type LeaseLifetime = { readonly kind: 'closed'; } | { readonly kind: 'failed'; readonly cause: unknown; };
type LeaseReadiness = {
    readonly ready: PromiseWithResolvers<BodyReadiness>;
    readonly close: PromiseWithResolvers<undefined>;
};
async function observeBodyLease(
    plan: TestPlan,
    signal: AbortSignal,
    readiness: LeaseReadiness
): Promise<LeaseLifetime> {
    try {
        await withBodyPlanAdmission(plan, signal, async function retain(resolved, activations) {
            readiness.ready.resolve({ plan: resolved, activations });
            await readiness.close.promise;
        });
        return { kind: 'closed' };
    } catch (error: unknown) {
        readiness.ready.reject(error);
        return { kind: 'failed', cause: error };
    } finally {
        readiness.close.resolve(undefined);
    }
}
export async function startBodyPlanLease(plan: TestPlan, signal: AbortSignal): Promise<BodyPlanLease> {
    const readiness = { ready: Promise.withResolvers<BodyReadiness>(), close: Promise.withResolvers<undefined>() };
    const lifetime = observeBodyLease(plan, signal, readiness);
    const admitted = await readiness.ready.promise;
    return {
        plan: admitted.plan,
        async run(operation) {
            return await withImplementationActivations(admitted.activations, operation);
        },
        async close() {
            readiness.close.resolve(undefined);
            const result = await lifetime;
            if (result.kind === 'failed') {
                throw result.cause;
            }
        }
    };
}
