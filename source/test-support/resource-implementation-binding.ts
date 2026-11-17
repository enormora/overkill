import { z } from 'zod/v4';
import { resourceAttachments } from '../attachments/attachment-context.ts';
import { defineImplementationReference, implementationFacts } from '../implementation-reference.ts';
import {
    defineResourceOwnerReference,
    defineResourceConsumerReference,
    type ResourceOwnerImplementation,
    type ResourceConsumerImplementation,
    type ResourceOwnerReference,
    type ResourceConsumerReference
} from '../resources/resource-implementation-reference.ts';
import type { ReferenceAdmission } from '../resources/resource-definition-shape.ts';

type BindingInput = { readonly prefix: string; };
type ConsumerHandle = { readonly address: string; };
type ResourceImplementationBinding = {
    readonly owner: ResourceOwnerReference<URL>;
    readonly consumer: ResourceConsumerReference<ConsumerHandle>;
    readonly ownerImplementation: ResourceOwnerImplementation<URL, BindingInput>;
    readonly consumerImplementation: ResourceConsumerImplementation<ConsumerHandle, BindingInput>;
    readonly admission: ReferenceAdmission;
    readonly context: Parameters<ResourceOwnerImplementation<URL, BindingInput>['acquire']>[0];
    readonly events: readonly string[];
};
const inputSchema = z.strictObject({ prefix: z.string() }).readonly();
export function resourceImplementationBinding(): ResourceImplementationBinding {
    const events: string[] = [];
    const reference = defineImplementationReference({
        module: { moduleUrl: 'file:///project/resource.mjs', exportName: 'resource' },
        realm: 'host',
        version: '1',
        input: { prefix: 'file:///resource' },
        dynamicModules: [],
        parseInput(input) {
            return inputSchema.parse(input);
        }
    });
    const ownerImplementation: ResourceOwnerImplementation<URL, BindingInput> = {
        acquire(_context, input) {
            events.push('acquire');
            return new URL(input.prefix);
        },
        async dispose(handle, _context, input) {
            events.push(`dispose:${handle.href}:${input.prefix}`);
        },
        exposeHandle(handle, context) {
            return new URL(`${handle.href}#${context.scenarios['mode']}`);
        },
        serializeHandle(handle) {
            return { url: handle.href };
        }
    };
    const consumerImplementation: ResourceConsumerImplementation<ConsumerHandle, BindingInput> = {
        deserializeHandle(payload, _context, input) {
            return { address: `${z.strictObject({ url: z.string() }).parse(payload).url}:${input.prefix}` };
        },
        exposeHandle(handle, context) {
            return { address: `${handle.address}#${context.scenarios['mode']}` };
        }
    };
    return {
        events,
        ownerImplementation,
        consumerImplementation,
        owner: defineResourceOwnerReference<URL, BindingInput>(reference),
        consumer: defineResourceConsumerReference<ConsumerHandle, BindingInput>(reference),
        admission: {
            namespace: { resource: { version: '1', implementation: ownerImplementation } },
            facts: implementationFacts(reference, { projectRoot: '/project' }),
            context: { projectRoot: '/project' }
        },
        context: {
            attachments: resourceAttachments('test'),
            dependencies: {},
            scenarios: { mode: 'second' },
            signal: AbortSignal.any([]),
            workload: null
        }
    };
}
