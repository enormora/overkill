import { z } from 'zod/v4';

const childProcessMessageKind = 'overkill-child-message';

const envelopeSchema = z.strictObject({
    correlationId: z.string(),
    kind: z.literal(childProcessMessageKind),
    message: z.unknown()
});

export type ChildProcessEnvelope<Message> = {
    readonly correlationId: string;
    readonly kind: typeof childProcessMessageKind;
    readonly message: Message;
};

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null;
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

export function envelopeMessage<Message>(
    value: unknown,
    correlationId: string,
    messageSchema: Readonly<z.ZodType<Message>>
): Message | null {
    if (!isRecord(value) || value.kind !== childProcessMessageKind || value.correlationId !== correlationId) {
        return null;
    }

    const parsed = envelopeSchema.safeParse(value);

    if (!parsed.success) {
        throw new TypeError('Invalid child-process IPC payload.', { cause: parsed.error });
    }

    const payload = messageSchema.safeParse(parsed.data.message);

    if (!payload.success) {
        throw new TypeError('Invalid child-process IPC payload.', { cause: payload.error });
    }

    return payload.data;
}
