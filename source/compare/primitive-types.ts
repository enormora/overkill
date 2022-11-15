type Constructor = new () => unknown;

function hasPrototype(value: object, expectedConstructor: Constructor): boolean {
    return Reflect.getPrototypeOf(value) === expectedConstructor.prototype;
}

type SetType = 'set' | 'custom-set' | 'weak-set' | 'custom-weak-set';

function detectSetType(value: ReadonlySet<unknown> | WeakSet<object>): SetType {
    if (value instanceof Set) {
        if (hasPrototype(value, Set)) {
            return 'set';
        }

        return 'custom-set';
    }

    if (hasPrototype(value, WeakSet)) {
        return 'weak-set';
    }

    return 'custom-weak-set';
}

type MapType = 'map' | 'weak-map' | 'custom-map' | 'custom-weak-map';

function detectMapType(value: ReadonlyMap<unknown, unknown> | WeakMap<object, unknown>): MapType {
    if (value instanceof Map) {
        if (hasPrototype(value, Map)) {
            return 'map';
        }

        return 'custom-map';
    }

    if (hasPrototype(value, WeakMap)) {
        return 'weak-map';
    }

    return 'custom-weak-map';
}

type ArrayType = 'array' | 'custom-array';

function detectArrayType(value: readonly unknown[]): ArrayType {
    if (hasPrototype(value, Array)) {
        return 'array';
    }

    return 'custom-array';
}

type ObjectType = 'object' | 'global-object' | 'null' | ArrayType | SetType | MapType | 'promise';

function detectObjectType(objectValue: unknown): ObjectType {
    if (objectValue === null) {
        return 'null';
    }
    if (Array.isArray(objectValue)) {
        return detectArrayType(objectValue);
    }
    if (objectValue === globalThis) {
        return 'global-object';
    }
    if (objectValue instanceof Promise) {
        return 'promise';
    }
    if (objectValue instanceof Set || objectValue instanceof WeakSet) {
        return detectSetType(objectValue);
    }
    if (objectValue instanceof Map || objectValue instanceof WeakMap) {
        return detectMapType(objectValue);
    }

    return 'object';
}

export type Primitive = 'string' | 'number' | 'function' | 'bigint' | 'boolean' | 'symbol' | 'undefined' | ObjectType;

export function detectType(value: unknown): Primitive {
    const type = typeof value;

    if (type === 'object') {
        return detectObjectType(value);
    }

    return type;
}
