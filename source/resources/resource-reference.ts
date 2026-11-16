import type { WorkloadParameters } from '../engine/workload-input.ts';
import type { ResourceWorkload } from './resource-workload-types.ts';
import type {
    ExecutionRequirement,
    ResourceDependencies,
    ResourceScope,
    ResourceConsumerBinding,
    ResourceOwnerBinding,
    ReferencedResourceImplementation
} from './resource-definition-shape.ts';
import { resourceDefinitionBrand } from './resource-definition-brand.ts';
import { freezeResourceScenarioSlots, type ResourceScenarioSlots } from './resource-scenario.ts';

export type ResourceReference<
    Name extends string,
    Owner extends ResourceOwnerBinding,
    Consumer extends ResourceConsumerBinding | null,
    Dependencies extends ResourceDependencies
> = {
    readonly kind: 'resource-reference';
    readonly acquire: null;
    readonly dispose: null;
    readonly exposeHandle: null;
    readonly implementation: {
        readonly owner: Owner;
        readonly consumer: Consumer;
        readonly workload: ResourceWorkload<WorkloadParameters> | null;
    };
    readonly name: Name;
    readonly dependencies: Dependencies;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scenarios: ResourceScenarioSlots;
    readonly scope: ResourceScope;
    readonly workload: ((parameters: WorkloadParameters) => WorkloadParameters) | null;
    readonly [resourceDefinitionBrand]: true;
};

export type ResourceReferenceDeclaration<
    Name extends string,
    Owner extends ResourceOwnerBinding,
    Consumer extends ResourceConsumerBinding | null,
    Dependencies extends ResourceDependencies
> = {
    readonly name: Name;
    readonly owner: Owner;
    readonly consumer: Consumer;
    readonly dependencies: Dependencies;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scenarios: ResourceScenarioSlots;
    readonly scope: ResourceScope;
    readonly workload: ((parameters: WorkloadParameters) => WorkloadParameters) | null;
};

export function defineResourceReference<
    const Name extends string,
    Owner extends ResourceOwnerBinding,
    Consumer extends ResourceConsumerBinding | null,
    const Dependencies extends ResourceDependencies
>(
    declaration: ResourceReferenceDeclaration<Name, Owner, Consumer, Dependencies>
): ResourceReference<Name, Owner, Consumer, Dependencies> {
    if (declaration.scope === 'per-run' && declaration.consumer === null) {
        throw new TypeError('Per-run resource references require a consumer projection.');
    }
    if (
        declaration.consumer !== null && (declaration.scope === 'per-case' || declaration.scope === 'shared-per-worker')
    ) {
        throw new TypeError('Resource projections require per-run, per-file, or per-suite scope.');
    }
    return Object.freeze<ResourceReference<Name, Owner, Consumer, Dependencies>>({
        kind: 'resource-reference',
        acquire: null,
        dispose: null,
        exposeHandle: null,
        implementation: Object.freeze({ owner: declaration.owner, consumer: declaration.consumer, workload: null }),
        name: declaration.name,
        dependencies: Object.freeze({ ...declaration.dependencies }),
        requirements: Object.freeze(Array.from(declaration.requirements)),
        scenarios: freezeResourceScenarioSlots(declaration.scenarios),
        scope: declaration.scope,
        workload: declaration.workload,
        [resourceDefinitionBrand]: true
    });
}

type ResourceReferenceCandidate = { readonly acquire: unknown; };
type ReferencedResourceCandidate = {
    readonly kind: 'resource-reference';
    readonly acquire: null;
    readonly implementation: ReferencedResourceImplementation;
};
export function hasResourceImplementation(
    resource: ResourceReferenceCandidate
): resource is ReferencedResourceCandidate {
    return resource.acquire === null && Object.hasOwn(resource, 'implementation') &&
        Reflect.get(resource, 'kind') === 'resource-reference';
}
