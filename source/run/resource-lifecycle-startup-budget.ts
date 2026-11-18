import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
import type {
    AnyResourceDefinition,
    ResourceCreationContext,
    ResourceScenarioSlots,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import { callableResourceDefinition } from '../resources/resource-graph.ts';

export type StartupBudgetRuntime = { readonly schedule: (milliseconds: number, expire: () => void) => () => void; };
type StartupBudgetRequirement = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};

type StartupBudgetTimer = {
    readonly cancel: () => void;
    readonly timeout: Promise<void>;
};

const resourceStartupTimeoutBrand = Symbol('ResourceStartupTimeout');

function resourceStartupTimeoutError(message: string): Error {
    const error = new Error(message);

    Object.defineProperty(error, resourceStartupTimeoutBrand, { value: true });

    return error;
}

export function isResourceStartupTimeoutError(error: unknown): boolean {
    return typeof error === 'object' &&
        error !== null &&
        Reflect.get(error, resourceStartupTimeoutBrand) === true;
}

function isStartupBudgetRequirement(requirement: unknown): requirement is StartupBudgetRequirement {
    if (requirement === null || typeof requirement !== 'object') {
        return false;
    }

    const kind: unknown = Reflect.get(requirement, 'kind');
    const minimumMilliseconds: unknown = Reflect.get(requirement, 'minimumMilliseconds');

    return kind === 'startup-budget-milliseconds' &&
        typeof minimumMilliseconds === 'number' &&
        Number.isFinite(minimumMilliseconds) &&
        minimumMilliseconds >= 0;
}

function startupBudgetMilliseconds(resource: AnyResourceDefinition): number | null {
    const budgets = resource.requirements.flatMap(function toBudget(requirement) {
        return isStartupBudgetRequirement(requirement) ? [ requirement.minimumMilliseconds ] : [];
    });

    return budgets.length === 0 ? null : Math.max(...budgets);
}

function createStartupBudgetTimer(
    resource: AnyResourceDefinition,
    budgetMilliseconds: number,
    controller: AbortController,
    runtime: StartupBudgetRuntime
): StartupBudgetTimer {
    const timeout = Promise.withResolvers<undefined>();
    const cancel = runtime.schedule(budgetMilliseconds, function abortForStartupBudget() {
        const error = resourceStartupTimeoutError(
            `Resource "${resource.name}" exceeded startup budget of ${budgetMilliseconds} ms.`
        );

        controller.abort(error);
        timeout.reject(error);
    });

    return {
        cancel() {
            cancel();
            timeout.resolve(undefined);
        },
        timeout: timeout.promise
    };
}

function linkParentSignal(parentSignal: AbortSignal, controller: AbortController): () => void {
    const abortForParentSignal = function abortForParentSignal(): void {
        controller.abort(parentSignal.reason);
    };

    parentSignal.addEventListener('abort', abortForParentSignal, { once: true });

    return function unlinkParentSignal() {
        parentSignal.removeEventListener('abort', abortForParentSignal);
    };
}

export async function acquireBudgetedResource(
    resource: AnyResourceDefinition,
    context: ResourceCreationContext<ResourceMap, ResourceScenarioSlots>,
    runtime: StartupBudgetRuntime
): Promise<unknown> {
    const budgetMilliseconds = startupBudgetMilliseconds(resource);

    if (budgetMilliseconds === null) {
        return await callableResourceDefinition(resource).acquire(context);
    }

    const controller = new AbortController();
    const timer = createStartupBudgetTimer(resource, budgetMilliseconds, controller, runtime);
    const unlinkParentSignal = linkParentSignal(context.signal, controller);

    try {
        return await Promise.race([
            callableResourceDefinition(resource).acquire({
                attachments: context.attachments,
                dependencies: context.dependencies,
                scenarios: context.scenarios,
                signal: controller.signal,
                workload: context.workload
            }),
            timer.timeout
        ]);
    } finally {
        timer.cancel();
        unlinkParentSignal();
    }
}

export async function acquireResourceWithStartupBudget(
    resource: AnyResourceDefinition,
    context: ResourceCreationContext<ResourceMap, ResourceScenarioSlots>
): Promise<unknown> {
    return await acquireBudgetedResource(resource, context, {
        schedule(milliseconds, expire) {
            const timer = setNodeTimeout(expire, milliseconds);
            return function cancel() {
                clearNodeTimeout(timer);
            };
        }
    });
}
