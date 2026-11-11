import { createStoredValue } from '../stored-value.ts';

type FamilyPhase = 'collected' | 'collecting' | 'disposed' | 'disposing' | 'executing' | 'prepared';

export type FamilyLifetime = {
    readonly signal: AbortSignal;
    readonly claim: (expected: FamilyPhase, next: FamilyPhase) => void;
    readonly collected: () => void;
    readonly observe: <Value>(operation: () => Promise<Value>) => Promise<Value>;
    readonly abandon: () => Promise<void>;
    readonly disposeOnce: () => Promise<readonly unknown[]>;
};

export function createFamilyLifetime(dispose: () => Promise<void>): FamilyLifetime {
    const phase = createStoredValue<FamilyPhase>('prepared');
    const activity = createStoredValue(Promise.resolve());
    const disposal = createStoredValue<Promise<readonly unknown[]> | null>(null);
    const controller = new AbortController();
    async function cleanup(): Promise<readonly unknown[]> {
        await activity.read();
        try {
            await dispose();
            return [];
        } catch (error: unknown) {
            return [ error ];
        } finally {
            phase.write('disposed');
        }
    }
    async function disposeOnce(): Promise<readonly unknown[]> {
        const existing = disposal.read();
        if (existing !== null) {
            return existing;
        }
        phase.write('disposing');
        const pending = cleanup();
        disposal.write(pending);
        return pending;
    }
    return {
        signal: controller.signal,
        claim(expected, next) {
            if (phase.read() !== expected) {
                throw new TypeError('Family value has already been consumed or disposed.');
            }
            phase.write(next);
        },
        collected() {
            controller.signal.throwIfAborted();
            phase.write('collected');
        },
        async observe(operation) {
            const pending = Promise.withResolvers<undefined>();
            activity.write(pending.promise);
            try {
                return await operation();
            } finally {
                pending.resolve(undefined);
            }
        },
        async abandon() {
            if (phase.read() === 'disposed') {
                return;
            }
            controller.abort();
            const errors = await disposeOnce();
            if (errors.length > 0) {
                throw new AggregateError(errors, 'Family cleanup failed.');
            }
        },
        disposeOnce
    };
}

export async function rejectWithFamilyCleanup(error: unknown, lifetime: FamilyLifetime): Promise<never> {
    const errors = await lifetime.disposeOnce();
    if (errors.length > 0) {
        throw new AggregateError([ error, ...errors ], 'Family operation and cleanup failed.', { cause: error });
    }
    throw error;
}
