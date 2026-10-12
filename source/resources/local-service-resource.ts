import type { Merge } from 'type-fest';
import type { WorkloadParameters } from '../engine/workload-input.ts';
import type { RuntimeAttachments } from '../engine/runtime-attachment.ts';
import { normalizeResourceDefinition } from './resource-definition.ts';
import type { ResourceWorkload, ResourceWorkloadDeclaration } from './resource-workload-types.ts';
import type {
    Awaitable,
    EmptyResourceDependencies,
    ExecutionRequirement,
    ResourceContext,
    ResourceDefinition,
    ResourceDependencies,
    ResourceDisposalContext,
    ResourceProjectionContext,
    ResourceProjectionPayload,
    ResourceScope
} from './resources.ts';
import type { ValueOf } from './resource-definition-shape.ts';

export type LocalServiceLoopbackAddressRequest = {
    readonly kind: 'loopback';
    readonly port: number;
};

export type LocalServiceHostAddressRequest = {
    readonly host: string;
    readonly kind: 'host';
    readonly port: number;
};

export type LocalServiceAddressRequest = LocalServiceHostAddressRequest | LocalServiceLoopbackAddressRequest;

export type LocalServiceAddress = {
    readonly host: string;
    readonly port: number;
};

export type LocalServiceCreationContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Parameters extends WorkloadParameters = never
> = {
    readonly attachments: RuntimeAttachments;
    readonly address: LocalServiceAddress;
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
    readonly workload: readonly [Parameters] extends readonly [never] ? null : ResourceWorkload<Parameters>;
};

export type LocalServiceDisposalContext<
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Parameters extends WorkloadParameters = never
> = {
    readonly attachments: RuntimeAttachments;
    readonly address: LocalServiceAddress;
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
    readonly workload: readonly [Parameters] extends readonly [never] ? null : ResourceWorkload<Parameters>;
};

export type LocalServiceConsumerHandle = Readonly<Partial<Record<PropertyKey, unknown>>>;

export type ProjectedLocalServiceScope = 'per-file' | 'per-run' | 'per-suite';

export type LocalServiceHandleProjection<
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Dependencies extends ResourceDependencies
> = {
    readonly deserializeHandle: (
        payload: Projection,
        context: ResourceProjectionContext<Dependencies>
    ) => ProjectedConsumerHandle;
    readonly serializeHandle: (
        handle: ConsumerHandle,
        context: ResourceProjectionContext<Dependencies>
    ) => Projection;
};

type LocalServiceDefinitionDisposal<
    OwnerHandle,
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
> = {
    readonly dispose: (
        owner: OwnerHandle,
        context: LocalServiceDisposalContext<Dependencies, Parameters>
    ) => Awaitable<void>;
};

type LocalServiceAcquisitionContext<
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
> = {
    readonly attachments: RuntimeAttachments;
    readonly dependencies: ResourceContext<Dependencies>;
    readonly signal: AbortSignal;
    readonly workload: readonly [Parameters] extends readonly [never] ? null : ResourceWorkload<Parameters>;
};

type ResourceAcquireFailure = {
    readonly cleanupError: unknown;
    readonly cause: unknown;
};

const localServiceAcquireFailures = new WeakMap<Error, ResourceAcquireFailure>();

function localServiceAcquireFailureError(failure: ResourceAcquireFailure): Error {
    const error = new Error('Local service acquisition failed.', { cause: failure.cause });

    localServiceAcquireFailures.set(error, failure);

    return error;
}

type LocalServiceResourceDefinitionBaseInput<
    Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends ResourceScope,
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
> = LocalServiceDefinitionDisposal<OwnerHandle, Dependencies, Parameters> & {
    readonly address: LocalServiceAddressRequest;
    readonly dependencies: Dependencies;
    readonly name: Name;
    readonly ready: (
        owner: OwnerHandle,
        context: LocalServiceCreationContext<Dependencies, Parameters>
    ) => Awaitable<ConsumerHandle>;
    readonly requirements: readonly ExecutionRequirement[];
    readonly scope: Scope;
    readonly start: (context: LocalServiceCreationContext<Dependencies, Parameters>) => Awaitable<OwnerHandle>;
};

export type LocalOnlyLocalServiceResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Parameters extends WorkloadParameters = never
> = LocalServiceResourceDefinitionBaseInput<Name, OwnerHandle, ConsumerHandle, Scope, Dependencies, Parameters>;

export type ProjectedLocalServiceResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Parameters extends WorkloadParameters = never
> = Merge<
    LocalServiceHandleProjection<ConsumerHandle, Projection, ProjectedConsumerHandle, Dependencies>,
    LocalServiceResourceDefinitionBaseInput<Name, OwnerHandle, ConsumerHandle, Scope, Dependencies, Parameters>
>;

export type LocalServiceResourceDefinitionInput<
    Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Dependencies extends ResourceDependencies = EmptyResourceDependencies,
    Projection extends ResourceProjectionPayload = ResourceProjectionPayload,
    ProjectedConsumerHandle = ConsumerHandle,
    Parameters extends WorkloadParameters = never
> = ValueOf<{
    readonly local: LocalOnlyLocalServiceResourceDefinitionInput<
        Name,
        OwnerHandle,
        ConsumerHandle,
        Exclude<ResourceScope, 'per-run'>,
        Dependencies,
        Parameters
    >;
    readonly projected: ProjectedLocalServiceResourceDefinitionInput<
        Name,
        OwnerHandle,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        ProjectedLocalServiceScope,
        Dependencies,
        Parameters
    >;
}>;

type LocalServiceOwnerStore<
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle
> = WeakMap<ConsumerHandle, OwnerHandle>;

function localServiceAddress(request: LocalServiceAddressRequest): LocalServiceAddress {
    return Object.freeze({
        host: request.kind === 'loopback' ? '127.0.0.1' : request.host,
        port: request.port
    });
}

export function isProjectedLocalServiceScope(scope: ResourceScope): scope is ProjectedLocalServiceScope {
    return [ 'per-file', 'per-run', 'per-suite' ].includes(scope);
}

function internalCleanupSignal(): AbortSignal {
    const controller = new AbortController();

    return controller.signal;
}

function resourceAcquireFailure(cause: unknown, cleanupError: unknown): ResourceAcquireFailure {
    return { cause, cleanupError };
}

function lifecycleError(failure: ResourceAcquireFailure): unknown {
    return failure.cleanupError === null
        ? failure.cause
        : new AggregateError(
            [ failure.cause, failure.cleanupError ],
            'Local service acquisition cleanup failed.'
        );
}

async function cleanupStartedService<
    OwnerHandle,
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
>(
    owner: OwnerHandle,
    definition: LocalServiceDefinitionDisposal<OwnerHandle, Dependencies, Parameters>,
    context: LocalServiceCreationContext<Dependencies, Parameters>
): Promise<unknown> {
    try {
        await definition.dispose(owner, {
            address: context.address,
            attachments: context.attachments,
            dependencies: context.dependencies,
            signal: internalCleanupSignal(),
            workload: context.workload
        });

        return null;
    } catch (error: unknown) {
        return error;
    }
}

function serviceContext<Dependencies extends ResourceDependencies, Parameters extends WorkloadParameters = never>(
    context: LocalServiceAcquisitionContext<Dependencies, Parameters>,
    address: LocalServiceAddress
): LocalServiceCreationContext<Dependencies, Parameters> {
    return Object.freeze({
        ...context,
        address
    });
}

async function acquireReadyHandle<
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
>(
    definition: LocalServiceResourceDefinitionBaseInput<
        string,
        OwnerHandle,
        ConsumerHandle,
        ResourceScope,
        Dependencies,
        Parameters
    >,
    context: LocalServiceCreationContext<Dependencies, Parameters>
): Promise<readonly [OwnerHandle, ConsumerHandle]> {
    context.signal.throwIfAborted();
    const owner = await definition.start(context);

    try {
        context.signal.throwIfAborted();
        const consumer = await definition.ready(owner, context);

        context.signal.throwIfAborted();

        return [ owner, consumer ];
    } catch (error: unknown) {
        throw localServiceAcquireFailureError(
            resourceAcquireFailure(error, await cleanupStartedService(owner, definition, context))
        );
    }
}

function localServiceAcquire<
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
>(
    definition: LocalServiceResourceDefinitionBaseInput<
        string,
        OwnerHandle,
        ConsumerHandle,
        ResourceScope,
        Dependencies,
        Parameters
    >,
    address: LocalServiceAddress,
    owners: LocalServiceOwnerStore<OwnerHandle, ConsumerHandle>
): (context: LocalServiceAcquisitionContext<Dependencies, Parameters>) => Promise<ConsumerHandle> {
    return async function startLocalService(context) {
        try {
            const [ owner, consumer ] = await acquireReadyHandle(
                definition,
                serviceContext(context, address)
            );

            owners.set(consumer, owner);

            return consumer;
        } catch (error: unknown) {
            if (error instanceof Error) {
                const failure = localServiceAcquireFailures.get(error);

                if (failure !== undefined) {
                    throw lifecycleError(failure);
                }
            }

            throw error;
        }
    };
}

function localServiceDispose<
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
>(
    definition: LocalServiceDefinitionDisposal<OwnerHandle, Dependencies, Parameters>,
    address: LocalServiceAddress,
    owners: LocalServiceOwnerStore<OwnerHandle, ConsumerHandle>
): (
    handle: ConsumerHandle,
    context: ResourceDisposalContext<Dependencies, Readonly<Record<PropertyKey, never>>, Parameters>
) => Awaitable<void> {
    return async function disposeLocalService(handle, context) {
        const owner = owners.get(handle);

        if (owner === undefined) {
            return;
        }

        owners.delete(handle);
        await definition.dispose(owner, {
            address,
            attachments: context.attachments,
            dependencies: context.dependencies,
            signal: context.signal,
            workload: context.workload
        });
    };
}

function isProjectedLocalService<
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Parameters extends WorkloadParameters = never
>(
    definition: LocalServiceResourceDefinitionInput<
        string,
        OwnerHandle,
        ConsumerHandle,
        Dependencies,
        Projection,
        ProjectedConsumerHandle,
        Parameters
    >
): definition is ProjectedLocalServiceResourceDefinitionInput<
    string,
    OwnerHandle,
    ConsumerHandle,
    Projection,
    ProjectedConsumerHandle,
    ProjectedLocalServiceScope,
    Dependencies,
    Parameters
> {
    return Object.hasOwn(definition, 'serializeHandle') && Object.hasOwn(definition, 'deserializeHandle');
}

export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters
>(
    definition: Merge<
        LocalOnlyLocalServiceResourceDefinitionInput<
            Name,
            OwnerHandle,
            ConsumerHandle,
            Scope,
            Dependencies,
            Parameters
        >,
        ResourceWorkloadDeclaration<Parameters>
    >
): ResourceDefinition<
    Name,
    ConsumerHandle,
    Dependencies,
    ConsumerHandle,
    Readonly<Record<PropertyKey, never>>,
    Parameters
>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    const Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters
>(
    definition: Merge<
        ProjectedLocalServiceResourceDefinitionInput<
            Name,
            OwnerHandle,
            ConsumerHandle,
            Projection,
            ProjectedConsumerHandle,
            Scope,
            Dependencies,
            Parameters
        >,
        ResourceWorkloadDeclaration<Parameters>
    >
): ResourceDefinition<
    Name,
    ConsumerHandle,
    Dependencies,
    ProjectedConsumerHandle,
    Readonly<Record<PropertyKey, never>>,
    Parameters
>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Scope extends Exclude<ResourceScope, 'per-run'>,
    const Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
>(
    definition: LocalOnlyLocalServiceResourceDefinitionInput<
        Name,
        OwnerHandle,
        ConsumerHandle,
        Scope,
        Dependencies,
        Parameters
    >
): ResourceDefinition<Name, ConsumerHandle, Dependencies>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Scope extends ProjectedLocalServiceScope,
    const Dependencies extends ResourceDependencies,
    Parameters extends WorkloadParameters = never
>(
    definition: ProjectedLocalServiceResourceDefinitionInput<
        Name,
        OwnerHandle,
        ConsumerHandle,
        Projection,
        ProjectedConsumerHandle,
        Scope,
        Dependencies,
        Parameters
    >
): ResourceDefinition<Name, ConsumerHandle, Dependencies, ProjectedConsumerHandle>;
export function defineLocalServiceResource<
    const Name extends string,
    OwnerHandle,
    ConsumerHandle extends LocalServiceConsumerHandle,
    const Dependencies extends ResourceDependencies,
    Projection extends ResourceProjectionPayload,
    ProjectedConsumerHandle,
    Parameters extends WorkloadParameters = never
>(
    definition: LocalServiceResourceDefinitionInput<
        Name,
        OwnerHandle,
        ConsumerHandle,
        Dependencies,
        Projection,
        ProjectedConsumerHandle,
        Parameters
    >
): unknown {
    const address = localServiceAddress(definition.address);
    const owners = new WeakMap<ConsumerHandle, OwnerHandle>();
    const acquire = localServiceAcquire(definition, address, owners);
    const dispose = localServiceDispose(definition, address, owners);

    if (isProjectedLocalService(definition)) {
        return normalizeResourceDefinition({
            workload: Reflect.get(definition, 'workload'),
            name: definition.name,
            scope: definition.scope,
            requirements: definition.requirements,
            dependencies: definition.dependencies,
            acquire,
            dispose,
            serializeHandle: definition.serializeHandle,
            deserializeHandle: definition.deserializeHandle
        });
    }

    return normalizeResourceDefinition({
        workload: Reflect.get(definition, 'workload'),
        name: definition.name,
        scope: definition.scope,
        requirements: definition.requirements,
        dependencies: definition.dependencies,
        acquire,
        dispose
    });
}
