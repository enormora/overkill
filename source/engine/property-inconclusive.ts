const propertyInconclusiveSignal = Symbol.for('@overkill-dev/engine/PropertyInconclusiveSignal/v1');

class PropertyInconclusiveSignalError extends Error {
    public constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = 'PropertyInconclusiveSignalError';
        Object.defineProperty(this, propertyInconclusiveSignal, { value: true });
    }
}

export function isPropertyInconclusiveSignalError(value: unknown): value is PropertyInconclusiveSignalError {
    return typeof value === 'object' && value !== null &&
        Reflect.get(value, propertyInconclusiveSignal) === true &&
        typeof Reflect.get(value, 'message') === 'string';
}

export function inconclusivePropertyTrial(reason: string): never {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
        throw new TypeError('Property inconclusive reasons must be nonblank strings.');
    }
    throw new PropertyInconclusiveSignalError(reason, { cause: undefined });
}
