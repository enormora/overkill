const loadErrorBrand = Symbol.for('@overkill-dev/ImplementationLoadError');
export class ImplementationLoadError extends Error {
    public constructor(message: string, options: ErrorOptions) {
        super(message, options);
        this.name = 'ImplementationLoadError';
        Object.defineProperty(this, loadErrorBrand, { value: true });
    }
}
export function isImplementationLoadError(value: unknown): value is ImplementationLoadError {
    return value instanceof Error && Reflect.get(value, loadErrorBrand) === true;
}
