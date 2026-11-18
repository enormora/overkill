import { defineResourceCheckObserverReference } from '../resources/resource-check-reference.ts';
import { readImplementationParticipants, type ImplementationParticipant } from '../implementation-participant.ts';
import type { AnyResourceDefinition, ReferenceAdmission } from '../resources/resource-definition-shape.ts';
import type {
    ResourceCheckObservation,
    ResourceCheckObserverReference,
    ResourceCheckInstallationContext
} from '../resources/resource-checks.ts';
import type { TestScope } from '../packages/test/test.entry-point.ts';
import { resourceImplementationBinding } from './resource-implementation-binding.ts';
import { resourceCheckSession, completeObservation } from './resource-check-session.ts';

type ResourceObserverBinding = {
    readonly observer: ResourceCheckObserverReference<AnyResourceDefinition>;
    readonly participant: ImplementationParticipant;
    readonly admission: ReferenceAdmission;
    readonly observation: ResourceCheckObservation;
    readonly context: ResourceCheckInstallationContext<AnyResourceDefinition>;
    readonly inputs: readonly unknown[];
};
function observerParticipant(
    observer: ResourceCheckObserverReference<AnyResourceDefinition>
): ImplementationParticipant {
    const participant = readImplementationParticipants(observer)[0];
    if (participant === undefined) {
        throw new Error('Missing observer participant.');
    }
    return participant;
}
export async function resourceObserverBinding(scope: TestScope): Promise<ResourceObserverBinding> {
    const fixture = resourceImplementationBinding();
    const observer = defineResourceCheckObserverReference(fixture.owner.reference);
    const participant = observerParticipant(observer);
    const observation: ResourceCheckObservation = {
        prepare() {
            return undefined;
        },
        finalize() {
            return { kind: 'complete' };
        }
    };
    const inputs: unknown[] = [];
    const checks = resourceCheckSession(completeObservation);
    await checks.session.install(scope.signal);
    scope.cleanup(async function () {
        await checks.session.close(function () {
            return undefined;
        });
    });
    return {
        observer,
        participant,
        observation,
        context: checks.context(),
        inputs,
        admission: {
            ...fixture.admission,
            namespace: {
                resource: {
                    version: '1',
                    implementation(_context: unknown, input: unknown) {
                        inputs.push(input);
                        return observation;
                    }
                }
            }
        }
    };
}
