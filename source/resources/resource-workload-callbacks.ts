import type { WorkloadParameters } from '../engine/workload-input.ts';
import type { Awaitable, ResourceDependencies } from './resource-definition-shape.ts';
import type { ResourceWorkload } from './resource-workload-types.ts';
import type { ResourceCreationContext, ResourceDisposalContext } from './resource-definition-types.ts';
import type { ResourceScenarioSlots } from './resource-scenario.ts';

type CreationContext = ResourceCreationContext<ResourceDependencies, ResourceScenarioSlots>;
type DisposalContext = ResourceDisposalContext<ResourceDependencies, ResourceScenarioSlots>;
type ResourceCallbacks = {
    readonly acquire: (context: never) => unknown;
    readonly dispose: ((handle: never, context: never) => Awaitable<void>) | null;
};
type WorkloadBoundCallbacks<Callbacks> = Callbacks & {
    readonly acquire: (context: CreationContext) => unknown;
    readonly dispose: ((handle: unknown, context: DisposalContext) => Promise<void>) | null;
};

export function withWorkloadCallbacks<Callbacks extends ResourceCallbacks>(
    callbacks: Callbacks,
    workload: ResourceWorkload<WorkloadParameters>
): WorkloadBoundCallbacks<Callbacks> {
    const { acquire, dispose } = callbacks;
    return {
        ...callbacks,
        acquire(context: CreationContext) {
            const handle: unknown = Reflect.apply(acquire, undefined, [ { ...context, workload } ]);
            return handle;
        },
        dispose: dispose === null
            ? null
            : async function disposeWorkloadResource(handle: unknown, context: DisposalContext) {
                const completion: unknown = Reflect.apply(dispose, undefined, [ handle, { ...context, workload } ]);
                await completion;
            }
    };
}
