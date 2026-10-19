export function executionTermination(cause: unknown): 'cancelled' | 'hard-timeout' | null {
    if (typeof cause !== 'object' || cause === null) {
        return null;
    }
    const termination: unknown = Reflect.get(cause, 'termination');
    return termination === 'hard-timeout' || termination === 'cancelled' ? termination : null;
}
