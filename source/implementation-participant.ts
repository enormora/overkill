import type {
    ImplementationFacts,
    ImplementationInputContext,
    ImplementationReference
} from './implementation-reference.ts';
import type { PortableValue } from './portable-value.ts';

export type ImplementationActivation = {
    readonly run: <Value>(operation: () => Promise<Value>) => Promise<Value>;
};
export type ImplementationParticipant = {
    readonly key: string;
    readonly role: 'body' | 'observer' | 'resource-consumer' | 'resource-owner';
    readonly scope: string | null;
    readonly binding: PortableValue;
    readonly reference: ImplementationReference<PortableValue>;
    readonly bind: (
        namespace: unknown,
        facts: ImplementationFacts,
        context: ImplementationInputContext
    ) => ImplementationActivation;
};
const participantsKey = Symbol.for('@overkill-dev/ImplementationParticipants');

type ParticipatingValue = { readonly [participantsKey]: readonly ImplementationParticipant[]; };

function hasParticipants(value: unknown): value is ParticipatingValue {
    return (typeof value === 'object' && value !== null || typeof value === 'function') &&
        Object.hasOwn(value, participantsKey);
}

export function readImplementationParticipants(value: unknown): readonly ImplementationParticipant[] {
    return hasParticipants(value) ? value[participantsKey] : [];
}

export type ImplementationCarrier = Readonly<Record<string, unknown>> | ((...parameters: readonly never[]) => unknown);

export function attachImplementationParticipants<Value extends ImplementationCarrier>(
    value: Value,
    participants: readonly ImplementationParticipant[]
): Value {
    if (participants.length === 0) {
        return value;
    }
    const merged = new Map(
        readImplementationParticipants(value).map(function entry(participant) {
            return [ participant.key, participant ];
        })
    );
    for (const participant of participants) {
        merged.set(participant.key, participant);
    }
    return Object.assign(value, { [participantsKey]: Object.freeze(Array.from(merged.values())) });
}

export async function withImplementationActivations<Value>(
    activations: readonly ImplementationActivation[],
    operation: () => Promise<Value>
): Promise<Value> {
    const [ first, ...remaining ] = activations;
    if (first === undefined) {
        return await operation();
    }
    return await first.run(async function activateRemaining() {
        return await withImplementationActivations(remaining, operation);
    });
}
