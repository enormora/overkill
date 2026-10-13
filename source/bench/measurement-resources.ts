import type {
    AsyncCollectorSession,
    AsyncMeasurementStrategy,
    CollectorSession,
    MeasurementStrategy,
    MetricReadings
} from './measurement-types.ts';

type DisposalOutcome = { readonly kind: 'failure'; readonly error: unknown; } | { readonly kind: 'success'; };
export type MeasurementResources = {
    readonly start: () => void;
    readonly stop: () => void;
    readonly complete: () => readonly MetricReadings[];
    readonly dispose: (outcome: DisposalOutcome) => void;
};
export type AsyncMeasurementResources = {
    readonly start: () => void;
    readonly stop: () => void;
    readonly complete: () => Promise<readonly MetricReadings[]>;
    readonly dispose: (outcome: DisposalOutcome) => Promise<void>;
};

function throwDisposalErrors(errors: readonly unknown[]): void {
    if (errors.length === 1) {
        throw errors[0];
    }
    if (errors.length > 1) {
        throw new AggregateError(errors, 'Measurement and collector disposal failed.');
    }
}

function disposeSession(session: CollectorSession): readonly unknown[] {
    try {
        session.dispose();
        return [];
    } catch (error: unknown) {
        return [ error ];
    }
}

export function prepareMeasurementResources(strategy: MeasurementStrategy, signal: AbortSignal): MeasurementResources {
    const sessions: CollectorSession[] = [];
    const resources: MeasurementResources = {
        start() {
            for (const session of sessions) {
                session.start();
            }
        },
        stop() {
            for (const session of sessions) {
                session.stop();
            }
        },
        complete() {
            return sessions.map(function complete(session) {
                return session.complete();
            });
        },
        dispose(outcome) {
            const errors: unknown[] = outcome.kind === 'failure' ? [ outcome.error ] : [];
            const pending = sessions.toReversed();
            sessions.length = 0;
            for (const session of pending) {
                errors.push(...disposeSession(session));
            }
            throwDisposalErrors(errors);
        }
    };
    const prepare = function prepareCollectors(): void {
        signal.throwIfAborted();
        for (const collector of strategy.collectors) {
            sessions.push(collector.prepare(signal));
        }
    };
    try {
        prepare();
    } catch (error: unknown) {
        resources.dispose({ kind: 'failure', error });
    }
    return resources;
}

async function disposeAsyncSession(session: AsyncCollectorSession | CollectorSession): Promise<readonly unknown[]> {
    try {
        await session.dispose();
        return [];
    } catch (error: unknown) {
        return [ error ];
    }
}

export async function prepareAsyncMeasurementResources(
    strategy: AsyncMeasurementStrategy,
    signal: AbortSignal
): Promise<AsyncMeasurementResources> {
    const sessions: (AsyncCollectorSession | CollectorSession)[] = [];
    const resources: AsyncMeasurementResources = {
        start() {
            for (const session of sessions) {
                session.start();
            }
        },
        stop() {
            for (const session of sessions) {
                session.stop();
            }
        },
        async complete() {
            const readings: MetricReadings[] = [];
            for (const session of sessions) {
                readings.push(await session.complete());
            }
            return readings;
        },
        async dispose(outcome) {
            const errors: unknown[] = outcome.kind === 'failure' ? [ outcome.error ] : [];
            const pending = sessions.toReversed();
            sessions.length = 0;
            for (const session of pending) {
                errors.push(...await disposeAsyncSession(session));
            }
            throwDisposalErrors(errors);
        }
    };
    const prepare = async function prepareCollectors(): Promise<void> {
        signal.throwIfAborted();
        for (const collector of strategy.collectors) {
            sessions.push(await collector.prepare(signal));
        }
    };
    try {
        await prepare();
    } catch (error: unknown) {
        await resources.dispose({ kind: 'failure', error });
    }
    return resources;
}
