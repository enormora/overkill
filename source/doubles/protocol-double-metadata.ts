import type { DoubleIteratorEvent } from './double-history-record.ts';

export type DisposableProtocol = 'async-disposable' | 'disposable';
export type IteratorProtocol = 'async-iterable' | 'async-iterator' | 'iterable' | 'iterator';
export type ProtocolKind = DisposableProtocol | IteratorProtocol;

type ProtocolMetadata = {
    readonly disposeMethod: () => unknown | null;
    readonly iteratorEvents: () => readonly DoubleIteratorEvent[];
    readonly kind: ProtocolKind;
};

const protocolMetadataSymbol = Symbol('overkill.protocolDoubleMetadata');

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return typeof value === 'object' && value !== null || typeof value === 'function';
}

function isProtocolMetadata(value: unknown): value is ProtocolMetadata {
    return isRecord(value) &&
        typeof Reflect.get(value, 'disposeMethod') === 'function' &&
        typeof Reflect.get(value, 'iteratorEvents') === 'function' &&
        typeof Reflect.get(value, 'kind') === 'string';
}

export function installProtocolMetadata(target: object, metadata: ProtocolMetadata): void {
    Object.defineProperty(target, protocolMetadataSymbol, {
        enumerable: false,
        value: metadata
    });
}

export function protocolMetadata(value: unknown): ProtocolMetadata | null {
    if (!isRecord(value) || !Object.hasOwn(value, protocolMetadataSymbol)) {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, protocolMetadataSymbol);

    return isProtocolMetadata(descriptor?.value) ? descriptor.value : null;
}

export function protocolDisposeMethod(value: unknown): unknown | null {
    return protocolMetadata(value)?.disposeMethod() ?? null;
}

export function protocolIteratorEvents(value: unknown): readonly DoubleIteratorEvent[] | null {
    return protocolMetadata(value)?.iteratorEvents() ?? null;
}
