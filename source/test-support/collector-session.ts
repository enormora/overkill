import type { MetricCollector, AsyncMetricCollector, MetricReadings } from '../bench/measurement-types.ts';
import { currentMeasurementContext } from '../bench/measurement-context.ts';
import { createCollectorLifetime } from '../bench/collector-lifetime.ts';

type TestCollectorSession = {
    readonly start: () => void;
    readonly stop: () => void;
    readonly complete: () => MetricReadings;
    readonly dispose: () => void;
};
export function prepareTestCollector(collector: MetricCollector, signal: AbortSignal): TestCollectorSession {
    const lifetime = createCollectorLifetime(currentMeasurementContext(), signal);
    const cleanup = new DisposableStack();
    const session = collector.prepare({
        ...lifetime.context,
        cleanup: {
            defer(release) {
                cleanup.defer(function releaseCollector() {
                    release(lifetime.shutdown().signal);
                });
            }
        }
    });
    return {
        start() {
            session.start(lifetime.context);
        },
        stop() {
            session.stop(lifetime.finalization(true));
        },
        complete() {
            return session.finalize(lifetime.finalization(true)).readings;
        },
        dispose() {
            cleanup.dispose();
            lifetime.finish([]);
        }
    };
}
export async function prepareAsyncTestCollector(collector: AsyncMetricCollector, signal: AbortSignal): Promise<{
    readonly start: () => Promise<void>;
    readonly stop: () => Promise<void>;
    readonly complete: () => Promise<MetricReadings>;
    readonly dispose: () => Promise<void>;
}> {
    const lifetime = createCollectorLifetime(currentMeasurementContext(), signal);
    const cleanup = new AsyncDisposableStack();
    try {
        const session = await collector.prepare({
            ...lifetime.context,
            cleanup: {
                defer(release) {
                    cleanup.defer(async function releaseCollector() {
                        await release(lifetime.shutdown().signal);
                    });
                }
            }
        });
        return {
            async start() {
                await session.start(lifetime.context);
            },
            async stop() {
                await session.stop(lifetime.finalization(true));
            },
            async complete() {
                const result = await session.finalize(lifetime.finalization(true));
                return result.readings;
            },
            async dispose() {
                await cleanup.disposeAsync();
                lifetime.finish([]);
            }
        };
    } catch (error: unknown) {
        await cleanup.disposeAsync();
        lifetime.finish([]);
        throw error;
    }
}
