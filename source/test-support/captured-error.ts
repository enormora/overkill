function requireError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    throw new TypeError('Expected an Error.', { cause: error });
}

export function captureThrownError(operation: () => unknown): Error {
    try {
        operation();
    } catch (error: unknown) {
        return requireError(error);
    }
    throw new Error('Expected the operation to throw.');
}

export async function captureRejectedError(operation: () => PromiseLike<unknown>): Promise<Error> {
    try {
        await operation();
    } catch (error: unknown) {
        return requireError(error);
    }
    throw new Error('Expected the operation to reject.');
}
