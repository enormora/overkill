import { isDeepStrictEqual } from 'node:util';
import type { Except } from 'type-fest';
import { z } from 'zod/v4';
import type { WorkloadParameters } from '../engine/workload-input.ts';
import {
    type ImplementationReference,
    readImplementationExport
} from '../implementation-reference.ts';
import { snapshotPortableValue, type PortableValue } from '../portable-value.ts';
import type { ResourceWorkload } from './resource-workload-types.ts';
import type {
    ReferenceAdmission,
    Awaitable,
    ResourceDependencies,
    ResourceProjectionPayload
} from './resource-definition-shape.ts';
import type {
    ResourceCreationContext,
    ResourceDisposalContext,
    ResourceHandleExposureContext,
    ResourceProjectionContext
} from './resource-definition-types.ts';
import type { ResourceScenarioSlots } from './resource-scenario.ts';

type OwnerWorkloadContext = { readonly workload: ResourceWorkload<WorkloadParameters> | null; };
type WithWorkload<Context extends OwnerWorkloadContext> = Except<Context, 'workload'> & OwnerWorkloadContext;
type CreationContext = WithWorkload<ResourceCreationContext<ResourceDependencies, ResourceScenarioSlots>>;
type DisposalContext = WithWorkload<ResourceDisposalContext<ResourceDependencies, ResourceScenarioSlots>>;
type ProjectionContext = ResourceProjectionContext<ResourceDependencies>;
type ExposureContext = ResourceHandleExposureContext<ResourceScenarioSlots>;

type OwnerProjection<Handle, Input extends PortableValue> = (
    handle: Handle,
    context: ProjectionContext,
    input: Input
) => ResourceProjectionPayload;

export type ResourceOwnerImplementation<Handle, Input extends PortableValue> = {
    readonly acquire: (context: CreationContext, input: Input) => Awaitable<Handle>;
    readonly dispose: ((handle: Handle, context: DisposalContext, input: Input) => Awaitable<void>) | null;
    readonly exposeHandle: ((handle: Handle, context: ExposureContext, input: Input) => Handle) | null;
    readonly serializeHandle: OwnerProjection<Handle, Input> | null;
};
export type ResourceConsumerImplementation<Handle, Input extends PortableValue> = {
    readonly deserializeHandle: (
        payload: ResourceProjectionPayload,
        context: ProjectionContext,
        input: Input
    ) => Handle;
    readonly exposeHandle: ((handle: Handle, context: ExposureContext, input: Input) => Handle) | null;
};
export type ResourceOwnerCallbacks<Handle> = {
    readonly acquire: (context: CreationContext) => Awaitable<Handle>;
    readonly dispose: ((handle: Handle, context: DisposalContext) => Awaitable<void>) | null;
    readonly exposeHandle: ((handle: Handle, context: ExposureContext) => Handle) | null;
    readonly serializeHandle: ((handle: Handle, context: ProjectionContext) => ResourceProjectionPayload) | null;
};
export type ResourceConsumerCallbacks<Handle> = {
    readonly deserializeHandle: (payload: ResourceProjectionPayload, context: ProjectionContext) => Handle;
    readonly exposeHandle: ((handle: Handle, context: ExposureContext) => Handle) | null;
};

export type ResourceOwnerReference<Handle> = {
    readonly kind: 'resource-owner-reference';
    readonly reference: ImplementationReference<PortableValue>;
    readonly bind: (admission: ReferenceAdmission) => ResourceOwnerCallbacks<Handle>;
};
export type ResourceConsumerReference<Handle> = {
    readonly kind: 'resource-consumer-reference';
    readonly reference: ImplementationReference<PortableValue>;
    readonly bind: (admission: ReferenceAdmission) => ResourceConsumerCallbacks<Handle>;
};

function referenceInput<Input extends PortableValue>(
    reference: ImplementationReference<Input>,
    admission: ReferenceAdmission
): Input {
    const input = snapshotPortableValue(reference.parseInput(reference.input, admission.context));
    if (!isDeepStrictEqual(input, admission.facts.input)) {
        throw new TypeError('Resource implementation inputs changed; prepare and collect a new run.');
    }
    return input;
}

export function defineResourceOwnerReference<Handle, Input extends PortableValue>(
    reference: ImplementationReference<Input>
): ResourceOwnerReference<Handle> {
    return Object.freeze({
        kind: 'resource-owner-reference',
        reference,
        bind(admission: ReferenceAdmission) {
            const callable = z.custom<ResourceOwnerImplementation<Handle, Input>['acquire']>(
                function isCallable(value) {
                    return typeof value === 'function';
                }
            );
            const schema = z.strictObject({
                acquire: callable,
                exposeHandle: z.custom<ResourceOwnerImplementation<Handle, Input>['exposeHandle']>(
                    function exposure(value) {
                        return value === null || typeof value === 'function';
                    }
                ),
                dispose: z.custom<ResourceOwnerImplementation<Handle, Input>['dispose']>(function disposal(value) {
                    return value === null || typeof value === 'function';
                }),
                serializeHandle: z.custom<ResourceOwnerImplementation<Handle, Input>['serializeHandle']>(
                    function projection(value) {
                        return value === null || typeof value === 'function';
                    }
                )
            });
            const owner = readImplementationExport(admission.namespace, admission.facts, schema.parse);
            const input = referenceInput(reference, admission);
            const { acquire, dispose, exposeHandle, serializeHandle } = owner;
            return {
                async acquire(context) {
                    return await acquire(context, input);
                },
                dispose: dispose === null ? null : async function disposeOwner(handle, context) {
                    await dispose(handle, context, input);
                },
                exposeHandle: exposeHandle === null ? null : function exposeOwner(handle, context) {
                    return exposeHandle(handle, context, input);
                },
                serializeHandle: serializeHandle === null ? null : function projectOwner(handle, context) {
                    return snapshotPortableValue(serializeHandle(handle, context, input));
                }
            };
        }
    });
}

export function defineResourceConsumerReference<Handle, Input extends PortableValue>(
    reference: ImplementationReference<Input>
): ResourceConsumerReference<Handle> {
    return Object.freeze({
        kind: 'resource-consumer-reference',
        reference,
        bind(admission: ReferenceAdmission) {
            const schema = z.strictObject({
                deserializeHandle: z.custom<ResourceConsumerImplementation<Handle, Input>['deserializeHandle']>(
                    function projection(value) {
                        return typeof value === 'function';
                    }
                ),
                exposeHandle: z.custom<ResourceConsumerImplementation<Handle, Input>['exposeHandle']>(
                    function exposure(value) {
                        return value === null || typeof value === 'function';
                    }
                )
            });
            const consumer = readImplementationExport(admission.namespace, admission.facts, schema.parse);
            const input = referenceInput(reference, admission);
            return {
                deserializeHandle(payload, context) {
                    return consumer.deserializeHandle(snapshotPortableValue(payload), context, input);
                },
                exposeHandle: consumer.exposeHandle === null ? null : function exposeHandle(handle, context) {
                    const expose = consumer.exposeHandle;
                    return expose === null ? handle : expose(handle, context, input);
                }
            };
        }
    });
}
