export function captureThrownError(operation: () => unknown): Error | undefined {
    try {
        operation();
        return undefined;
    } catch (error: unknown) {
        return error instanceof Error ? error : undefined;
    }
}

export async function captureRejectedError(operation: () => PromiseLike<unknown>): Promise<Error | undefined> {
    try {
        await operation();
        return undefined;
    } catch (error: unknown) {
        return error instanceof Error ? error : undefined;
    }
}
