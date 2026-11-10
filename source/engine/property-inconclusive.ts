export class PropertyInconclusiveSignalError extends Error {
    public constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = 'PropertyInconclusiveSignalError';
    }
}

export function inconclusivePropertyTrial(reason: string): never {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
        throw new TypeError('Property inconclusive reasons must be nonblank strings.');
    }
    throw new PropertyInconclusiveSignalError(reason, { cause: undefined });
}
