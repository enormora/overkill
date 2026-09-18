import {
    defineResource,
    type Awaitable,
    type EmptyResourceDependencies,
    type ExecutionRequirement,
    type ResourceCreationContext,
    type ResourceContext,
    type ResourceDefinition,
    type ResourceDependencies,
    type ResourceDisposalContext,
    type ResourceProjectionContext,
    type ResourceProjectionPayload,
    type ResourceScope
} from './resources.ts';
import type { ValueOf } from './resource-definition-shape.ts';

export type LocalServiceAddress = {
    readonly host: string;
    readonly port: number;
};

export type LocalServiceCreationContext<Dependencies extends ResourceDependencies = EmptyResourceDependencies> = {
    readonly address: LocalServiceAddress;
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
};

type ResourceWithOptionalDependencies<Dependencies extends ResourceDependencies> = {
    readonly dependencies?: Dependencies;
};
type ResourceWithDependencies<Dependencies extends ResourceDependencies> = {
    readonly dependencies: Dependencies;
};
type ProjectedLocalServiceScope = 'per-file' | 'per-run' | 'per-suite';
type ProjectedBase<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    Dependencies extends ResourceDependencies
> = ProjectedLocalServiceResourceDefinitionInput<
    Name,
    OwnerHandle,
    Projection,
    ConsumerHandle,
    Scope,
    Dependencies
>;
type ProjectedServiceWithDependencies<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    Dependencies extends ResourceDependencies
> = {
    readonly dependencies: Dependencies;
    readonly deserializeHandle: ProjectedBase<
        Name,
        OwnerHandle,
        Projection,
        ConsumerHandle,
        Scope,
        Dependencies
    >['deserializeHandle'];
    readonly dispose: ProjectedBase<Name, OwnerHandle, Projection, ConsumerHandle, Scope, Dependencies>['dispose'];
    readonly host?: string;
    readonly name: Name;
    readonly port?: number;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly serializeHandle: ProjectedBase<
        Name,
        OwnerHandle,
        Projection,
        ConsumerHandle,
        Scope,
        Dependencies
    >['serializeHandle'];
    readonly start: ProjectedBase<Name, OwnerHandle, Projection, ConsumerHandle, Scope, Dependencies>['start'];
};

type LocalServiceResourceDefinitionBaseInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = {
    readonly dependencies?: Dependencies;
    readonly dispose: (handle: Handle, context: ResourceDisposalContext<Dependencies>) => Awaitable<void>;
    readonly host?: string;
    readonly name: Name;
    readonly port?: number;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly start: (context: LocalServiceCreationContext<Dependencies>) => Awaitable<Handle>;
};

type LocalOnlyLocalServiceResourceDefinitionInput<
    Name extends string,
    Handle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = LocalServiceResourceDefinitionBaseInput<Name, Handle, Scope, Dependencies> & {
    readonly deserializeHandle?: never;
    readonly serializeHandle?: never;
};

type ProjectedLocalServiceResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies
> = LocalServiceResourceDefinitionBaseInput<Name, OwnerHandle, Scope, Dependencies> & {
    readonly deserializeHandle: (
        payload: Projection,
        context: ResourceProjectionContext<Dependencies>
    ) => ConsumerHandle;
    readonly serializeHandle: (
        handle: OwnerHandle,
        context: ResourceProjectionContext<Dependencies>
    ) => Projection;
};

export type LocalServiceResourceDefinitionInput<
    Name extends string,
    Handle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Projection extends ResourceProjectionPayload = ResourceProjectionPayload,
    ConsumerHandle = Handle
> = ValueOf<{
    readonly local: LocalOnlyLocalServiceResourceDefinitionInput<
        Name,
        Handle,
        Exclude<ResourceScope, 'per-run'>,
        Dependencies
    >;
    readonly projected: ProjectedLocalServiceResourceDefinitionInput<
        Name,
        Handle,
        Projection,
        ConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies
    >;
}>;

function localServiceAddress(host: string | undefined, port: number | undefined): LocalServiceAddress {
    return Object.freeze({
        host: host ?? '127.0.0.1',
        port: port ?? 0
    });
}

function localServiceAcquire<
    Name extends string,
    OwnerHandle,
    Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle
>(
    definition: LocalServiceResourceDefinitionInput<Name, OwnerHandle, Dependencies, Projection, ConsumerHandle>,
    address: LocalServiceAddress
): (context: ResourceCreationContext<Dependencies>) => Awaitable<OwnerHandle> {
    return async function startLocalService(context) {
        return definition.start(Object.freeze({
            ...context,
            address
        }));
    };
}

function hasDependencies<Dependencies extends ResourceDependencies>(
    definition: ResourceWithOptionalDependencies<Dependencies>
): definition is ResourceWithDependencies<Dependencies> {
    return definition.dependencies !== undefined;
}

function isProjectedLocalService<
    Name extends string,
    OwnerHandle,
    Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle
>(
    definition: LocalServiceResourceDefinitionInput<Name, OwnerHandle, Dependencies, Projection, ConsumerHandle>
): definition is ProjectedLocalServiceResourceDefinitionInput<
    Name,
    OwnerHandle,
    Projection,
    ConsumerHandle,
    ProjectedLocalServiceScope,
    Dependencies
> {
    return Object.hasOwn(definition, 'serializeHandle') && Object.hasOwn(definition, 'deserializeHandle');
}

export function defineLocalServiceResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>
>(
    definition: LocalOnlyLocalServiceResourceDefinitionInput<Name, Handle, Scope>
): ResourceDefinition<Name, Handle, EmptyResourceDependencies>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedLocalServiceScope
>(
    definition: ProjectedLocalServiceResourceDefinitionInput<Name, OwnerHandle, Projection, ConsumerHandle, Scope>
): ResourceDefinition<Name, OwnerHandle, EmptyResourceDependencies, ConsumerHandle>;
export function defineLocalServiceResource<
    const Name extends string,
    Handle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies
>(
    definition: LocalOnlyLocalServiceResourceDefinitionInput<Name, Handle, Scope, Dependencies> & {
        readonly dependencies: Dependencies;
    }
): ResourceDefinition<Name, Handle, Dependencies>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    const Dependencies extends ResourceDependencies
>(
    definition: ProjectedServiceWithDependencies<
        Name,
        OwnerHandle,
        Projection,
        ConsumerHandle,
        Scope,
        Dependencies
    >
): ResourceDefinition<Name, OwnerHandle, Dependencies, ConsumerHandle>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    const Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ConsumerHandle
>(
    definition: LocalServiceResourceDefinitionInput<Name, OwnerHandle, Dependencies, Projection, ConsumerHandle>
): unknown {
    const address = localServiceAddress(definition.host, definition.port);
    const acquire = localServiceAcquire(definition, address);

    if (isProjectedLocalService(definition)) {
        if (hasDependencies(definition)) {
            return defineResource({
                name: definition.name,
                scope: definition.scope,
                requirements: definition.requirements,
                acquire,
                dispose: definition.dispose,
                dependencies: definition.dependencies,
                serializeHandle: definition.serializeHandle,
                deserializeHandle: definition.deserializeHandle
            });
        }

        return defineResource({
            name: definition.name,
            scope: definition.scope,
            requirements: definition.requirements,
            acquire,
            dispose: definition.dispose,
            serializeHandle: definition.serializeHandle,
            deserializeHandle: definition.deserializeHandle
        });
    }

    if (hasDependencies(definition)) {
        return defineResource({
            name: definition.name,
            scope: definition.scope,
            requirements: definition.requirements,
            acquire,
            dispose: definition.dispose,
            dependencies: definition.dependencies
        });
    }

    return defineResource({
        name: definition.name,
        scope: definition.scope,
        requirements: definition.requirements,
        acquire,
        dispose: definition.dispose
    });
}
