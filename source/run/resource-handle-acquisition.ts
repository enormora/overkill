import { runWithResourceFailureContext } from '../attachments/resource-failure-context.ts';
import type { AnyResourceDefinition, ResourceContext, RuntimeResourceMap } from '../resources/resources.ts';
import { acquisitionResourceScenarioBindings } from '../resources/resource-scenario-binding.ts';
import { acquireResourceWithStartupBudget } from './resource-lifecycle-startup-budget.ts';
import { acquireOwnedResource, currentLifecycleAttempt } from './resource-lifecycle-state.ts';
import type { LifecycleBoundary } from './resource-lifecycle-boundaries.ts';
import type { ResourceLifecycleTiming } from './resource-lifecycle-timing.ts';
import type { TestPlanCase } from './run-engine-primitives.ts';

type ResourceHandleRequest = {
    readonly resource: AnyResourceDefinition;
    readonly dependencies: ResourceContext<RuntimeResourceMap>;
    readonly boundary: LifecycleBoundary;
    readonly testCase: TestPlanCase;
    readonly signal: AbortSignal;
    readonly timing: ResourceLifecycleTiming | null;
};
async function acquireCapturedHandle(request: ResourceHandleRequest): Promise<unknown> {
    const { resource, testCase, boundary, signal } = request;
    const condition = resource.scope === 'per-case'
        ? { kind: 'attempt' as const, work: testCase.workId, attempt: currentLifecycleAttempt() ?? { index: 0 } }
        : { kind: 'resource' as const, resource: resource.name, boundary: boundary.key };
    return await runWithResourceFailureContext({ name: resource.name, condition }, async function acquire(attachments) {
        return await acquireResourceWithStartupBudget(resource, {
            attachments,
            dependencies: request.dependencies,
            scenarios: acquisitionResourceScenarioBindings(resource),
            signal,
            workload: null
        });
    });
}
export async function acquireManagedResourceHandle(
    request: ResourceHandleRequest
): ReturnType<typeof acquireOwnedResource> {
    return await acquireOwnedResource(async function acquireObservedHandle() {
        const acquire = async function acquireHandle(): Promise<unknown> {
            return await acquireCapturedHandle(request);
        };
        return request.timing === null ? await acquire() : await request.timing.measure({
            phase: 'acquire',
            resource: { name: request.resource.name, scope: request.resource.scope },
            signal: request.signal
        }, acquire);
    });
}
