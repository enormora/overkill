import type { CollectorSession, MeasurementStrategy, MetricReadings } from './measurement-types.ts';
import { collectorState, createCollectorGroup, type MeasurementOutcome } from './collector-lifetime.ts';
import { validateCollectorResult } from './collector-result.ts';

export type MeasurementResources = {
    readonly start: () => void;
    readonly stop: () => void;
    readonly complete: () => readonly MetricReadings[];
    readonly dispose: (outcome: MeasurementOutcome) => void;
    readonly recordDuration: (duration: number) => void;
};
export function prepareMeasurementResources(strategy: MeasurementStrategy, signal: AbortSignal): MeasurementResources {
    const group = createCollectorGroup<CollectorSession, (signal: AbortSignal) => void>(signal);
    function attempt(operation: () => void): void {
        try {
            group.lifetime.shutdown().perform(operation);
        } catch (error: unknown) {
            group.lifetime.recordError(error);
        }
    }
    function stop(): void {
        const pending = group.sessions.read().filter(function needsStop(entry) {
            return entry.started.read() && !entry.stopped.read();
        });
        for (
            const state of pending
        ) {
            state.stopped.write(true);
            attempt(function stopCollector() {
                state.session.stop(group.lifetime.finalization(true));
            });
        }
    }
    function finalize(): void {
        const pending = group.sessions.read().filter(function needsFinalization(entry) {
            return !entry.finalized.read();
        });
        for (
            const state of pending
        ) {
            state.finalized.write(true);
            attempt(function finalizeCollector() {
                const context = group.lifetime.finalization(state.started.read());
                const result = state.session.finalize(context);
                group.lifetime.shutdown().check();
                const validated = validateCollectorResult(result, context, state.metrics);
                state.result.write({ ...result, readings: validated });
                group.readings.write([ ...group.readings.read(), validated ]);
            });
        }
    }
    const resources: MeasurementResources = {
        recordDuration: group.lifetime.recordDuration,
        start() {
            for (const state of group.sessions.read()) {
                signal.throwIfAborted();
                state.started.write(true);
                try {
                    state.session.start(group.lifetime.context);
                } catch (error: unknown) {
                    throw group.lifetime.collectorFailure(error).error;
                }
            }
            signal.throwIfAborted();
        },
        stop,
        complete() {
            finalize();
            return group.readings.read();
        },
        dispose(outcome) {
            if (group.closed.read()) {
                return;
            }
            group.closed.write(true);
            group.lifetime.fail(outcome);
            stop();
            finalize();
            for (const release of group.releases.read().toReversed()) {
                attempt(function releaseCollector() {
                    release(group.lifetime.shutdown().signal);
                });
            }
            group.lifetime.finish(
                group.sessions.read().map(function collectorEvidence(state) {
                    return { name: state.name, version: state.version, result: state.result.read() };
                })
            );
        }
    };
    function prepare(): void {
        signal.throwIfAborted();
        for (const collector of strategy.collectors) {
            const session = collector.prepare({
                ...group.lifetime.context,
                cleanup: {
                    defer(release) {
                        group.releases.write([ ...group.releases.read(), release ]);
                    }
                }
            });
            group.sessions.write([
                ...group.sessions.read(),
                collectorState(collector.name, collector.version, collector.metrics, session)
            ]);
            signal.throwIfAborted();
        }
    }
    try {
        prepare();
    } catch (error: unknown) {
        resources.dispose(group.lifetime.collectorFailure(error));
    }
    return resources;
}
