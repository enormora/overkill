import type {
    AsyncCollectorSession,
    CollectorSession,
    AsyncMeasurementStrategy,
    AsyncMetricCollector,
    MetricCollector,
    MetricReadings
} from './measurement-types.ts';
import { collectorState, createCollectorGroup, type MeasurementOutcome } from './collector-lifetime.ts';
import { validateCollectorResult } from './collector-result.ts';
import { awaitMeasurement } from './measurement-shutdown.ts';

type CollectorRelease = (signal: AbortSignal) => Promise<void> | void;

export type AsyncMeasurementResources = {
    readonly start: () => Promise<void>;
    readonly stop: () => Promise<void>;
    readonly complete: () => Promise<readonly MetricReadings[]>;
    readonly dispose: (outcome: MeasurementOutcome) => Promise<void>;
    readonly recordDuration: (duration: number) => void;
};
async function prepareCollectorSessions(
    strategy: AsyncMeasurementStrategy,
    signal: AbortSignal,
    prepare: (collector: AsyncMetricCollector | MetricCollector) => Promise<void>
): Promise<void> {
    signal.throwIfAborted();
    for (const collector of strategy.collectors) {
        await awaitMeasurement(prepare(collector), signal);
        signal.throwIfAborted();
    }
}
export async function prepareAsyncMeasurementResources(
    strategy: AsyncMeasurementStrategy,
    signal: AbortSignal
): Promise<AsyncMeasurementResources> {
    const group = createCollectorGroup<
        AsyncCollectorSession | CollectorSession,
        (signal: AbortSignal) => Promise<void> | void
    >(signal);
    async function attempt(operation: () => Promise<void> | void): Promise<void> {
        try {
            await group.lifetime.shutdown().run(operation);
        } catch (error: unknown) {
            group.lifetime.recordError(error);
        }
    }
    async function stop(): Promise<void> {
        const pending = group.sessions.read().filter(function needsStop(entry) {
            return entry.started.read() && !entry.stopped.read();
        });
        for (
            const state of pending
        ) {
            state.stopped.write(true);
            await attempt(async function stopCollector() {
                await state.session.stop(group.lifetime.finalization(true));
            });
        }
    }
    async function finalize(): Promise<void> {
        const pending = group.sessions.read().filter(function needsFinalization(entry) {
            return !entry.finalized.read();
        });
        for (
            const state of pending
        ) {
            state.finalized.write(true);
            await attempt(async function finalizeCollector() {
                const context = group.lifetime.finalization(state.started.read());
                const result = await state.session.finalize(context);
                if (!context.signal.aborted) {
                    group.lifetime.shutdown().check();
                    const validated = validateCollectorResult(result, context, state.metrics);
                    state.result.write({ ...result, readings: validated });
                    group.readings.write([ ...group.readings.read(), validated ]);
                }
            });
        }
    }
    const resources: AsyncMeasurementResources = {
        recordDuration: group.lifetime.recordDuration,
        async start() {
            for (const state of group.sessions.read()) {
                signal.throwIfAborted();
                state.started.write(true);
                try {
                    await awaitMeasurement(Promise.resolve(state.session.start(group.lifetime.context)), signal);
                } catch (error: unknown) {
                    throw group.lifetime.collectorFailure(error).error;
                }
            }
            signal.throwIfAborted();
        },
        stop,
        async complete() {
            await finalize();
            return group.readings.read();
        },
        async dispose(outcome) {
            if (group.closed.read()) {
                return;
            }
            group.closed.write(true);
            group.lifetime.fail(outcome);
            await stop();
            await finalize();
            for (const release of group.releases.read().toReversed()) {
                await attempt(async function releaseCollector() {
                    await release(group.lifetime.shutdown().signal);
                });
            }
            await Promise.all(group.lateCleanup.read());
            group.lifetime.finish(
                group.sessions.read().map(function collectorEvidence(state) {
                    return { name: state.name, version: state.version, result: state.result.read() };
                })
            );
        }
    };
    async function prepareCollector(collector: AsyncMetricCollector | MetricCollector): Promise<void> {
        const session = await collector.prepare({
            ...group.lifetime.context,
            cleanup: {
                defer(release: CollectorRelease) {
                    if (group.closed.read()) {
                        group.lateCleanup.write([
                            ...group.lateCleanup.read(),
                            attempt(async function releaseLateAllocation() {
                                await release(group.lifetime.shutdown().signal);
                            })
                        ]);
                    } else {
                        group.releases.write([ ...group.releases.read(), release ]);
                    }
                }
            }
        });
        if (!group.closed.read()) {
            group.sessions.write([
                ...group.sessions.read(),
                collectorState(collector.name, collector.version, collector.metrics, session)
            ]);
        }
    }
    try {
        await prepareCollectorSessions(strategy, signal, prepareCollector);
    } catch (error: unknown) {
        await resources.dispose(group.lifetime.collectorFailure(error));
    }
    return resources;
}
