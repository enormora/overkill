export type ThrownErrorRecord = {
    readonly message: string;
    readonly name: string;
    readonly stack: string | null;
    readonly thrown: unknown;
};

export function createThrownErrorRecord(thrown: unknown): ThrownErrorRecord {
    if (thrown instanceof Error) {
        return {
            message: thrown.message,
            name: thrown.name,
            stack: thrown.stack ?? null,
            thrown
        };
    }

    return {
        message: 'Test body threw a non-error value.',
        name: typeof thrown,
        stack: null,
        thrown
    };
}
