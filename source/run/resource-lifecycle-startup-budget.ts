import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from 'node:timers';
import type {
    AnyResourceDefinition,
    ResourceCreationContext,
    RuntimeResourceMap as ResourceMap
} from '../resources/resources.ts';
import { callableResourceDefinition } from '../resources/resource-graph.ts';

type StartupBudgetRequirement = {
    readonly kind: 'startup-budget-milliseconds';
    readonly minimumMilliseconds: number;
};

type StartupBudgetTimer = {
    readonly cancel: () => void;
    readonly timeout: Promise<never>;
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
    controller: AbortController
): StartupBudgetTimer {
    let rejectTimeout = function rejectBeforeTimeoutReady(error: Error): void {
        throw error;
    };
    const timeout = new Promise<never>(function createStartupTimeout(_resolve, reject) {
        rejectTimeout = reject;
    });
    const timer = setNodeTimeout(function abortForStartupBudget() {
        const error = resourceStartupTimeoutError(
            `Resource "${resource.name}" exceeded startup budget of ${budgetMilliseconds} ms.`
        );

        controller.abort(error);
        rejectTimeout(error);
    }, budgetMilliseconds);

    return {
        cancel() {
            clearNodeTimeout(timer);
        },
        timeout
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

export async function acquireResourceWithStartupBudget(
    resource: AnyResourceDefinition,
    context: ResourceCreationContext<ResourceMap>
): Promise<unknown> {
    const budgetMilliseconds = startupBudgetMilliseconds(resource);

    if (budgetMilliseconds === null) {
        return await callableResourceDefinition(resource).acquire(context);
    }

    const controller = new AbortController();
    const timer = createStartupBudgetTimer(resource, budgetMilliseconds, controller);
    const unlinkParentSignal = linkParentSignal(context.signal, controller);

    try {
        return await Promise.race([
            callableResourceDefinition(resource).acquire({
                dependencies: context.dependencies,
                signal: controller.signal
            }),
            timer.timeout
        ]);
    } finally {
        timer.cancel();
        unlinkParentSignal();
    }
}
