import { types } from 'node:util';
import { z } from 'zod/v4';
import type { EncodedPropertyInput } from '../packages/engine/engine.entry-point.ts';
import { defineCodec, type PropertyCodecDecoder, type PropertyInputCodec } from './property-codec.ts';
import { decodeGraph, encodeGraph } from './property-graph-v1.ts';

const format = Object.freeze({ name: 'overkill-property-graph', version: 1 });
const standard = Object.freeze({ name: 'overkill-standard-input', version: 1 });
const identitySchema = z.strictObject({ name: z.string(), version: z.number().int().positive() });
const envelopeSchema = z.strictObject({ format: identitySchema, codec: identitySchema, payload: z.json() });

export class PropertyCodecError extends Error {
    public constructor(operation: string, options: ErrorOptions) {
        super(`Property input codec ${operation} failed.`, options);
        this.name = 'PropertyCodecError';
    }
}

function codecOperation<Value>(operation: string, consume: () => void, execute: (visit: () => void) => Value): Value {
    const controlFailures = new Set<unknown>();
    function visit(): void {
        try {
            consume();
        } catch (error: unknown) {
            controlFailures.add(error);
            throw error;
        }
    }
    try {
        return execute(visit);
    } catch (error: unknown) {
        if (controlFailures.has(error) || error instanceof Error && error.name === 'AbortError') {
            throw error;
        }
        throw new PropertyCodecError(operation, { cause: error });
    }
}

type CodecIdentity = { readonly name: string; readonly version: number; };
function matchesIdentity(actual: CodecIdentity, expected: CodecIdentity): boolean {
    return actual.name === expected.name && actual.version === expected.version;
}

function selectDecoder<Value>(identity: CodecIdentity, codec: PropertyInputCodec<Value>): PropertyCodecDecoder<Value> {
    const selected = defineCodec(codec);
    if (identity.name !== selected.name) {
        throw new TypeError('Unsupported property input codec name.');
    }
    const decoder = identity.version === selected.version ? selected : selected.previousDecoders.find(
        function matchingVersion(previous) {
            return previous.version === identity.version;
        }
    );
    if (decoder === undefined) {
        throw new TypeError('Unsupported property input codec version.');
    }
    return decoder;
}

function decodePayload<Value>(payload: unknown, decoder: PropertyCodecDecoder<Value> | null): unknown {
    const decoded = decoder === null ? payload : decoder.decode(payload);
    if (types.isPromise(decoded)) {
        throw new TypeError('Property input codecs must be synchronous.');
    }
    return decoded;
}

export function decodePropertyInput<Value>(
    input: unknown,
    codec: PropertyInputCodec<Value>,
    consume: () => void
): Value;
export function decodePropertyInput<Value>(
    input: unknown,
    codec: PropertyInputCodec<Value> | null,
    consume: () => void
): unknown;
export function decodePropertyInput<Value>(
    input: unknown,
    codec: PropertyInputCodec<Value> | null,
    consume: () => void
): unknown {
    return codecOperation('decode', consume, function decodeStoredInput(visit) {
        const envelope = envelopeSchema.parse(input);
        if (!matchesIdentity(envelope.format, format)) {
            throw new TypeError('Unsupported property input format.');
        }
        if (codec === null && !matchesIdentity(envelope.codec, standard)) {
            throw new TypeError('Unsupported property input format or codec version.');
        }
        const decoder = codec === null ? null : selectDecoder(envelope.codec, codec);
        const payload = decodeGraph(envelope.payload, visit);
        return decodePayload(payload, decoder);
    });
}

export function capturePropertyInput<Value>(
    value: Value,
    codec: PropertyInputCodec<Value> | null,
    consume: () => void
): EncodedPropertyInput {
    return codecOperation('capture', consume, function captureCurrentInput(visit) {
        const selected = codec === null ? null : defineCodec(codec);
        const encoded = {
            format,
            codec: selected === null ? standard : { name: selected.name, version: selected.version },
            payload: encodeGraph(selected === null ? value : selected.encode(value), visit)
        };
        decodePropertyInput(encoded, selected, visit);
        return encoded;
    });
}

export function migratePropertyInput<Value>(
    input: unknown,
    codec: PropertyInputCodec<Value> | null,
    consume: () => void
): EncodedPropertyInput {
    return codecOperation('migration', consume, function migrateStoredInput(visit) {
        if (codec === null) {
            return capturePropertyInput(decodePropertyInput(input, null, visit), null, visit);
        }
        const selected = defineCodec(codec);
        return capturePropertyInput(decodePropertyInput(input, selected, visit), selected, visit);
    });
}
