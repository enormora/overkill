export async function preloadImplementation(
    load: () => Promise<{ readonly namespace: unknown; }>,
    signal: AbortSignal
): Promise<{ readonly namespace: unknown; }> {
    signal.throwIfAborted();
    const aborted = Promise.withResolvers<never>();
    function abort(): void {
        aborted.reject(signal.reason);
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
        return await Promise.race([ load(), aborted.promise ]);
    } finally {
        signal.removeEventListener('abort', abort);
        aborted.reject(new Error('Implementation preload completed.'));
    }
}
