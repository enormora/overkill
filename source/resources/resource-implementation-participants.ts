import type { ImplementationParticipant } from '../implementation-participant.ts';
import type { ResourceDependencies } from './resource-definition-shape.ts';
import { createResourceGraph } from './resource-graph.ts';
import { hasResourceImplementation } from './resource-reference.ts';
import { withResourceConsumer, withResourceOwner } from './resource-reference-binding.ts';

export function resourceImplementationParticipants(
    resources: ResourceDependencies
): readonly ImplementationParticipant[] {
    return createResourceGraph(resources).order.flatMap(function resourceParticipants({ descriptor: resource }) {
        if (!hasResourceImplementation(resource)) {
            return [];
        }
        const { owner, consumer } = resource.implementation;
        const participants: ImplementationParticipant[] = [ {
            role: 'resource-owner',
            scope: resource.scope,
            binding: resource.implementation.workload,
            key: `resource-owner:${resource.scope}:${resource.name}`,
            reference: owner.reference,
            bind(namespace, facts, context) {
                const callbacks = owner.bind({ namespace, facts, context });
                if (consumer !== null && callbacks.serializeHandle === null) {
                    throw new TypeError(`Resource "${resource.name}" requires an owner projection.`);
                }
                if (
                    consumer === null && callbacks.exposeHandle === null &&
                    Object.values(resource.scenarios).some(function requestRouted(slot) {
                        return slot.timing === 'request-routed';
                    })
                ) {
                    throw new TypeError('Request-routed resource scenarios require an owner handle exposure.');
                }
                return {
                    async run(operation) {
                        return await withResourceOwner(owner, callbacks, operation);
                    }
                };
            }
        } ];
        if (consumer !== null) {
            participants.push({
                role: 'resource-consumer',
                scope: resource.scope,
                binding: resource.implementation.workload,
                key: `resource-consumer:${resource.scope}:${resource.name}`,
                reference: consumer.reference,
                bind(namespace, facts, context) {
                    const callbacks = consumer.bind({ namespace, facts, context });
                    if (
                        callbacks.exposeHandle === null &&
                        Object.values(resource.scenarios).some(function requestRouted(slot) {
                            return slot.timing === 'request-routed';
                        })
                    ) {
                        throw new TypeError('Request-routed resource scenarios require a consumer handle exposure.');
                    }
                    return {
                        async run(operation) {
                            return await withResourceConsumer(consumer, callbacks, operation);
                        }
                    };
                }
            });
        }
        return participants;
    });
}
