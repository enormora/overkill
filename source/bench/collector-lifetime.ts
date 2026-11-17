import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { CollectorResult, MeasurementInvocationEvidence } from '../engine/measurement-evidence.ts';
import { currentMeasurementContext, type MeasurementContext } from './measurement-context.ts';
import { microsecondsPerMillisecond } from './measurement-units.ts';
import type {
    CollectorContext,
    CollectorFinalizationContext,
    MetricDeclaration,
    MetricReadings
} from './measurement-types.ts';
import { createMeasurementShutdown, type MeasurementShutdown } from './measurement-shutdown.ts';

export type CollectorState<Session> = {
    readonly name: string;
    readonly version: string;
    readonly metrics: readonly MetricDeclaration[];
    readonly session: Session;
    readonly started: StoredValue<boolean>;
    readonly stopped: StoredValue<boolean>;
    readonly finalized: StoredValue<boolean>;
    readonly result: StoredValue<CollectorResult | null>;
};
export function collectorState<Session>(
    name: string,
    version: string,
    metrics: readonly MetricDeclaration[],
    session: Session
): CollectorState<Session> {
    return {
        name,
        version,
        metrics,
        session,
        started: createStoredValue(false),
        stopped: createStoredValue(false),
        finalized: createStoredValue(false),
        result: createStoredValue<CollectorResult | null>(null)
    };
}
export type MeasurementOutcome = { readonly kind: 'failure'; readonly error: unknown; } | { readonly kind: 'success'; };
export type CollectorLifetime = {
    readonly context: CollectorContext;
    readonly recordError: (error: unknown) => void;
    readonly shutdown: () => MeasurementShutdown;
    readonly finalization: (started: boolean) => CollectorFinalizationContext;
    readonly fail: (outcome: MeasurementOutcome) => void;
    readonly collectorFailure: (error: unknown) => Extract<MeasurementOutcome, { readonly kind: 'failure'; }>;
    readonly recordDuration: (duration: number) => void;
    readonly finish: (collectors: MeasurementInvocationEvidence['collectors']) => void;
};
function throwMeasurementErrors(errors: readonly unknown[]): void {
    if (errors.length === 1) {
        throw errors[0];
    }
    if (errors.length > 1) {
        throw new AggregateError(errors, 'Measurement and collector shutdown failed.');
    }
}
export function createCollectorLifetime(input: MeasurementContext, signal: AbortSignal): CollectorLifetime {
    const errors: unknown[] = [];
    const started = performance.now();
    let duration: number | null = null;
    let outcome: MeasurementOutcome = { kind: 'success' };
    let shutdown: MeasurementShutdown | null = null;
    const context = { invocation: input.invocation, target: input.target.identity, signal };
    const cleanup = function cleanupDeadline(): MeasurementShutdown {
        shutdown = shutdown ?? createMeasurementShutdown();
        return shutdown;
    };
    return {
        context,
        recordError(error) {
            errors.push(error);
            input.infrastructureError(error);
        },
        shutdown: cleanup,
        finalization(wasStarted) {
            return {
                ...context,
                signal: cleanup().signal,
                started: wasStarted,
                outcome,
                readings(readings) {
                    return {
                        invocation: input.invocation,
                        target: input.target.identity,
                        completeness: { kind: 'complete' },
                        readings
                    };
                }
            };
        },
        collectorFailure(error) {
            if (!signal.aborted) {
                errors.push(error);
                input.infrastructureError(error);
            }
            return { kind: 'failure', error };
        },
        fail(failure) {
            outcome = failure;
        },
        recordDuration(value) {
            duration = value;
        },
        finish(collectors) {
            shutdown?.close();
            const settledOutcome = outcome;
            const failures = settledOutcome.kind === 'failure'
                ? [
                    settledOutcome.error,
                    ...errors.filter(function additionalFailure(error) {
                        return error !== settledOutcome.error;
                    })
                ]
                : errors;
            input.record({
                invocation: input.invocation,
                target: input.target.identity,
                collectors,
                status: failures.length === 0 ? 'complete' : 'incomplete',
                errors: failures.map(function errorText(error) {
                    return error instanceof Error ? error.message : String(error);
                }),
                durationMicroseconds: duration,
                lifecycleMicroseconds: duration === null ? null : Math.max(
                    0,
                    (performance.now() - started) * microsecondsPerMillisecond - duration
                )
            });
            throwMeasurementErrors(failures);
        }
    };
}

export type CollectorGroup<Session, Release> = {
    readonly lifetime: CollectorLifetime;
    readonly sessions: StoredValue<readonly CollectorState<Session>[]>;
    readonly releases: StoredValue<readonly Release[]>;
    readonly readings: StoredValue<readonly MetricReadings[]>;
    readonly closed: StoredValue<boolean>;
    readonly lateCleanup: StoredValue<readonly Promise<void>[]>;
};
export function createCollectorGroup<Session, Release>(signal: AbortSignal): CollectorGroup<Session, Release> {
    return {
        lifetime: createCollectorLifetime(currentMeasurementContext(), signal),
        sessions: createStoredValue<readonly CollectorState<Session>[]>([]),
        releases: createStoredValue<readonly Release[]>([]),
        readings: createStoredValue<readonly MetricReadings[]>([]),
        closed: createStoredValue(false),
        lateCleanup: createStoredValue<readonly Promise<void>[]>([])
    };
}
