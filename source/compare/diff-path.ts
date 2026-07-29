import type { DiffPathSegment } from '../diff/diff-shape.ts';
import { type SerializedPropertyKey, serializeValue } from './serialized-value.ts';

function serializedKey(key: PropertyKey): SerializedPropertyKey {
    return typeof key === 'symbol'
        ? { kind: 'symbol', value: key.toString() }
        : { kind: 'string', value: String(key) };
}

export function propertySegment(key: PropertyKey): DiffPathSegment {
    return {
        key: serializedKey(key),
        kind: 'property'
    };
}

export function indexSegment(index: number): DiffPathSegment {
    return { index, kind: 'index' };
}

export function byteSegment(offset: number): DiffPathSegment {
    return { kind: 'byte', offset };
}

export function mapKeySegment(key: unknown): DiffPathSegment {
    return {
        key: serializeValue(key),
        kind: 'map-key'
    };
}

export function mapValueSegment(key: unknown): DiffPathSegment {
    return {
        key: serializeValue(key),
        kind: 'map-value'
    };
}

export function setValueSegment(value: unknown): DiffPathSegment {
    return {
        kind: 'set-value',
        value: serializeValue(value)
    };
}
