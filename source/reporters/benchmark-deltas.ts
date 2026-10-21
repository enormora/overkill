const percentMultiplier = 100;
export function difference(actual: number | null, expected: number | null): number | null {
    if (actual === null || expected === null) {
        return null;
    }
    const delta = actual - expected;
    return Number.isFinite(delta) ? delta : null;
}
export function percentDifference(actual: number | null, expected: number | null): number | null {
    const delta = difference(actual, expected);
    if (delta === null || expected === null || expected === 0) {
        return null;
    }
    const percent = delta / Math.abs(expected) * percentMultiplier;
    return Number.isFinite(percent) ? percent : null;
}
