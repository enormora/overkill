const childProcessMessageKind = 'overkill-child-message';

export type ChildProcessEnvelope<Message> = {
    readonly correlationId: string;
    readonly kind: typeof childProcessMessageKind;
    readonly message: Message;
};

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
}

function ignoreTypeWitness(typeWitness: readonly unknown[]): void {
    String(typeWitness.length);
}

export function childProcessEnvelope<Message>(
    correlationId: string,
    message: Message
): ChildProcessEnvelope<Message> {
    return {
        correlationId,
        kind: childProcessMessageKind,
        message
    };
}

function isChildProcessEnvelope<Message>(
    value: unknown,
    correlationId: string
): value is ChildProcessEnvelope<Message> {
    return isRecord(value) &&
        value.kind === childProcessMessageKind &&
        value.correlationId === correlationId &&
        Object.hasOwn(value, 'message');
}

export function envelopeMessage<Message>(
    value: unknown,
    correlationId: string,
    ...typeWitness: readonly [Message?]
): Message | null {
    ignoreTypeWitness(typeWitness);

    if (!isChildProcessEnvelope<Message>(value, correlationId)) {
        return null;
    }

    return value.message;
}
