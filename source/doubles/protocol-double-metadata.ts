import type { DoubleIteratorEvent } from './double-history-record.ts';
import type { UnknownFunction } from './double-behavior.ts';

type DisposableProtocol = 'async-disposable' | 'disposable';
type IteratorProtocol = 'async-iterable' | 'async-iterator' | 'iterable' | 'iterator';
type ProtocolKind = DisposableProtocol | IteratorProtocol;

type ProtocolMetadata = {
    readonly disposeMethod: () => UnknownFunction<unknown> | null;
    readonly iteratorEvents: () => readonly DoubleIteratorEvent[];
    readonly kind: ProtocolKind;
};

const protocolMetadataSymbol = Symbol('overkill.protocolDoubleMetadata');

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
    return value !== null && (typeof value === 'object' || typeof value === 'function');
}

function isProtocolMetadata(value: unknown): value is ProtocolMetadata {
    return isRecord(value) &&
        typeof Reflect.get(value, 'disposeMethod') === 'function' &&
        typeof Reflect.get(value, 'iteratorEvents') === 'function' &&
        typeof Reflect.get(value, 'kind') === 'string';
}

export function installProtocolMetadata(target: NonNullable<unknown>, metadata: ProtocolMetadata): void {
    Object.defineProperty(target, protocolMetadataSymbol, {
        enumerable: false,
        value: metadata
    });
}

function protocolMetadata(value: unknown): ProtocolMetadata | null {
    if (!isRecord(value) || !Object.hasOwn(value, protocolMetadataSymbol)) {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(value, protocolMetadataSymbol);

    return isProtocolMetadata(descriptor?.value) ? descriptor.value : null;
}

export function protocolDisposeMethod(value: unknown): UnknownFunction<unknown> | null {
    return protocolMetadata(value)?.disposeMethod() ?? null;
}

export function protocolIteratorEvents(value: unknown): readonly DoubleIteratorEvent[] | null {
    return protocolMetadata(value)?.iteratorEvents() ?? null;
}
