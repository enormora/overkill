export type AssertionOutcome = {
    readonly actual: unknown;
    readonly expected: unknown;
    readonly passed: boolean;
};

export function assertionOutcome(actual: unknown, expected: unknown, passed: boolean): AssertionOutcome {
    return { actual, expected, passed };
}
