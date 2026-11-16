import { isDeepStrictEqual } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod/v4';
import { attachImplementationParticipants } from '../implementation-participant.ts';
import { readImplementationExport, type ImplementationReference } from '../implementation-reference.ts';
import type { PortableValue } from '../portable-value.ts';
import type { AnyResourceDefinition, Awaitable } from './resource-definition-shape.ts';
import type {
    ResourceCheckObserverReference,
    ResourceCheckInstaller,
    ResourceCheckInstallationContext,
    ResourceCheckObservation
} from './resource-checks.ts';

export function defineResourceCheckObserverReference<
    Resource extends AnyResourceDefinition,
    Input extends PortableValue
>(
    reference: ImplementationReference<Input>
): ResourceCheckObserverReference<Resource> {
    type Implementation = (
        context: ResourceCheckInstallationContext<Resource>,
        input: Input
    ) => Awaitable<ResourceCheckObservation>;
    const binding = new AsyncLocalStorage<Implementation>();
    const inputs = new AsyncLocalStorage<Input>();
    const installer: ResourceCheckInstaller<Resource> = async function (context) {
        const implementation = binding.getStore();
        const input = inputs.getStore();
        if (implementation === undefined || input === undefined) {
            throw new TypeError('Resource observer implementation was not admitted.');
        }
        return await implementation(context, input);
    };
    return attachImplementationParticipants(
        Object.assign(installer, { kind: 'resource-check-observer-reference' as const }),
        [ {
            key: `observer:${reference.module.moduleUrl}:${reference.module.exportName}`,
            role: 'observer',
            scope: null,
            binding: null,
            reference,
            bind(namespace, facts, context) {
                const implementation = readImplementationExport(
                    namespace,
                    facts,
                    z
                        .custom<Implementation>(function (value) {
                            return typeof value === 'function';
                        })
                        .parse
                );
                const input = reference.parseInput(reference.input, context);
                if (!isDeepStrictEqual(input, facts.input)) {
                    throw new TypeError('Observer inputs changed; prepare and collect a new run.');
                }
                return {
                    async run(operation) {
                        return await binding.run(implementation, async function () {
                            return await inputs.run(input, operation);
                        });
                    }
                };
            }
        } ]
    );
}
