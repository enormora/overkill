import { z } from 'zod/v4';
import { attachImplementationParticipants, readImplementationParticipants } from '../implementation-participant.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import {
    resourceCheckRunIdentity,
    stopResourceCheckAttempt,
    stopResourceCheckWork
} from '../resource-check-cancellation.ts';
import type {
    ResourceCheckInterval,
    ResourceCheckIntervalContext,
    ResourceCheckCompleteness,
    ResourceCheckWriter,
    ResourceCheckSnapshot
} from './resource-check-contract.ts';
import { createResourceCheckSupervision, type ResourceCheckSupervision } from './resource-check-supervision.ts';
import type { ResourceAcquiredHandle } from './resource-definition-types.ts';
import type { AnyResourceDefinition, Awaitable } from './resource-definition-shape.ts';
import { createResourceCheckLedger, type ResourceCheckLedger } from './resource-check-ledger.ts';

export type ResourceCheckObservation = {
    readonly prepare: (context: ResourceCheckIntervalContext) => Awaitable<void>;
    readonly finalize: (context: ResourceCheckIntervalContext) => Awaitable<ResourceCheckCompleteness>;
};

export type ResourceCheckInstallationContext<Resource extends AnyResourceDefinition> = {
    readonly handle: ResourceAcquiredHandle<Resource>;
    readonly resource: string;
    readonly signal: AbortSignal;
    readonly ledger: ResourceCheckWriter;
    readonly cleanup: {
        readonly defer: (cleanup: (signal: AbortSignal) => Awaitable<void>) => void;
    };
};
export type ResourceCheckInstaller<Resource extends AnyResourceDefinition> = (
    context: ResourceCheckInstallationContext<Resource>
) => Awaitable<ResourceCheckObservation>;
export type ResourceCheckObserverReference<Resource extends AnyResourceDefinition> = {
    (context: ResourceCheckInstallationContext<Resource>): Awaitable<ResourceCheckObservation>;
    readonly kind: 'resource-check-observer-reference';
};
export type ResourceCheckObserver<Resource extends AnyResourceDefinition> = ResourceCheckInstaller<Resource>;

const observersKey = Symbol.for('@overkill-dev/resource-checks/v1');
export function resourceCheckInstallers(
    resource: AnyResourceDefinition
): readonly ResourceCheckInstaller<AnyResourceDefinition>[] {
    const value: unknown = Reflect.get(resource, observersKey);
    return z
        .array(z.custom<ResourceCheckInstaller<AnyResourceDefinition>>(function (entry) {
            return typeof entry === 'function';
        }))
        .parse(value ?? []);
}
export function withResourceChecks<Resource extends AnyResourceDefinition>(
    resource: Resource,
    observer: ResourceCheckObserver<Resource>
): Resource {
    const installers = resourceCheckInstallers(resource);
    const decorated = { ...resource, [observersKey]: Object.freeze([ ...installers, observer ]) };
    const participants = readImplementationParticipants(observer).map(function scopedObserver(participant) {
        return {
            ...participant,
            scope: resource.scope,
            key: `resource-observer:${resource.scope}:${resource.name}:${installers.length}:${participant.key}`
        };
    });
    attachImplementationParticipants(decorated, participants);
    Object.freeze(decorated);
    return decorated;
}
const budgetMilliseconds = 2000;
const lifetime: ResourceCheckInterval = { kind: 'lifetime' };
type Cleanup = (signal: AbortSignal) => Awaitable<void>;
export type ResourceCheckSession = {
    readonly assertAdmitted: () => void;
    readonly install: (signal: AbortSignal) => Promise<void>;
    readonly prepare: (interval: ResourceCheckInterval) => Promise<void>;
    readonly finalize: (interval: ResourceCheckInterval) => Promise<void>;
    readonly close: (dispose: Cleanup) => Promise<void>;
    readonly snapshots: () => readonly ResourceCheckSnapshot[];
};
type ResourceCheckPhase = 'admitted' | 'closed' | 'closing' | 'installing' | 'stopped';
type ObservationState = {
    readonly supervision: ResourceCheckSupervision;
    readonly lateCleanup: StoredValue<readonly Promise<void>[]>;
    readonly observations: StoredValue<readonly ResourceCheckObservation[]>;
    readonly cleanup: AsyncDisposableStack;
    readonly controller: AbortController;
    readonly finalizations: StoredValue<ReadonlyMap<string, Promise<void>>>;
    readonly ledger: ResourceCheckLedger;
    readonly deadline: StoredValue<number>;
    readonly phase: StoredValue<ResourceCheckPhase>;
    readonly installation: StoredValue<Promise<void> | null>;
    readonly closure: StoredValue<Promise<void> | null>;
    readonly resource: AnyResourceDefinition;
    readonly handle: unknown;
};
function now(state: ObservationState): number {
    return state.supervision.now();
}
function remaining(state: ObservationState): number {
    return Math.min(budgetMilliseconds, state.deadline.read() - now(state));
}
function beginClosure(state: ObservationState): void {
    if (!Number.isFinite(state.deadline.read())) {
        state.deadline.write(now(state) + budgetMilliseconds);
    }
    state.phase.write('closing');
}
async function capture(
    state: ObservationState,
    operation: Cleanup,
    errors: StoredValue<readonly unknown[]>
): Promise<void> {
    try {
        await state.supervision.run(operation, state.controller.signal, remaining(state));
    } catch (error: unknown) {
        errors.write([ ...errors.read(), error ]);
        state.ledger.writer.error(lifetime, null, error);
    }
}
async function release(state: ObservationState, callback: Cleanup): Promise<void> {
    const errors = createStoredValue<readonly unknown[]>([]);
    await capture(state, callback, errors);
    if (errors.read().length > 0) {
        throw new AggregateError(errors.read(), 'Observer cleanup failed.');
    }
}
async function releaseLate(state: ObservationState, callback: Cleanup): Promise<void> {
    try {
        const controller = new AbortController();
        await state.supervision.run(callback, controller.signal, budgetMilliseconds);
    } catch (error: unknown) {
        state.ledger.writer.error(lifetime, null, error);
    }
}
function register(state: ObservationState, callback: Cleanup): void {
    if (state.phase.read() === 'closed' || state.cleanup.disposed) {
        state.lateCleanup.write([ ...state.lateCleanup.read(), releaseLate(state, callback) ]);
        return;
    }
    state.cleanup.defer(async function () {
        await release(state, callback);
    });
}
function installationContext(
    state: ObservationState,
    signal: AbortSignal
): ResourceCheckInstallationContext<AnyResourceDefinition> {
    return {
        handle: state.handle,
        resource: state.resource.name,
        signal,
        ledger: state.ledger.writer,
        cleanup: {
            defer(callback) {
                register(state, callback);
            }
        }
    };
}
function validateObservationInstallation(state: ObservationState): void {
    if (
        state.ledger.snapshots().some(function hasObservationErrors(snapshot) {
            return snapshot.errors.length > 0;
        })
    ) {
        throw new Error('Resource observation reported installation errors.');
    }
}
async function installObservers(state: ObservationState, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    for (const installer of resourceCheckInstallers(state.resource)) {
        const observation = await installer(installationContext(state, signal));
        signal.throwIfAborted();
        if (typeof observation.prepare !== 'function' || typeof observation.finalize !== 'function') {
            throw new TypeError('Resource observers require preparation and finalization callbacks.');
        }
        state.observations.write([ ...state.observations.read(), observation ]);
        validateObservationInstallation(state);
    }
    if (state.phase.read() === 'installing') {
        state.phase.write('admitted');
    }
}
async function installBounded(state: ObservationState, signal: AbortSignal): Promise<void> {
    await Promise.resolve();
    try {
        await state.supervision.run(
            async function (installationSignal) {
                await installObservers(state, installationSignal);
            },
            signal,
            budgetMilliseconds
        );
    } catch (error: unknown) {
        if (state.phase.read() === 'installing' || state.phase.read() === 'admitted') {
            state.phase.write('stopped');
        }
        state.ledger.writer.error(lifetime, null, error);
        throw error;
    }
}
function assertAdmitted(state: ObservationState): void {
    if (state.phase.read() !== 'admitted') {
        throw new Error(`Resource observation is ${state.phase.read()}.`);
    }
}
async function install(state: ObservationState, signal: AbortSignal): Promise<void> {
    if (state.installation.read() === null) {
        state.installation.write(installBounded(state, signal));
    }
    await state.installation.read();
    assertAdmitted(state);
}
function snapshots(state: ObservationState): readonly ResourceCheckSnapshot[] {
    return state.ledger.snapshots();
}
async function prepare(state: ObservationState, interval: ResourceCheckInterval): Promise<void> {
    state.ledger.open(interval);
    if (state.resource.scope === 'per-case') {
        beginClosure(state);
    }
    const errors = createStoredValue<readonly unknown[]>([]);
    for (const observation of state.observations.read()) {
        await capture(state, async function (signal) {
            await observation.prepare({ interval, signal });
        }, errors);
    }
    if (errors.read().length > 0) {
        throw new AggregateError(errors.read(), 'Resource preparation failed.');
    }
}
const observationCompletenessSchema = z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('complete') }),
    z.strictObject({ kind: z.literal('incomplete'), reasons: z.array(z.string()) })
]);
async function finalizeObservation(
    state: ObservationState,
    observation: ResourceCheckObservation,
    interval: ResourceCheckInterval
): Promise<ResourceCheckCompleteness> {
    try {
        return await state.supervision.run(
            async function (signal) {
                return observationCompletenessSchema.parse(await observation.finalize({ interval, signal }));
            },
            state.controller.signal,
            remaining(state)
        );
    } catch (error: unknown) {
        state.ledger.writer.error(interval, null, error);
        return { kind: 'incomplete', reasons: [ 'Observer finalization failed.' ] };
    }
}
async function finalizeInterval(state: ObservationState, interval: ResourceCheckInterval): Promise<void> {
    await Promise.resolve();
    const reasons: string[] = [];
    for (const observation of state.observations.read()) {
        const result = await finalizeObservation(state, observation, interval);
        if (result.kind === 'incomplete') {
            reasons.push(
                ...result.reasons.length === 0 ? [ 'Observer reported incomplete observation.' ] : result.reasons
            );
        }
    }
    const completeness = state.ledger.finalize(
        interval,
        reasons.length === 0 ? { kind: 'complete' } : { kind: 'incomplete', reasons }
    );
    if (completeness.kind === 'incomplete') {
        throw new AggregateError(completeness.reasons, 'Resource observation is incomplete.');
    }
}
async function finalize(state: ObservationState, interval: ResourceCheckInterval): Promise<void> {
    const key = interval.kind === 'lifetime'
        ? 'lifetime'
        : `${workIdentityKey(interval.work)}:${interval.attempt.index}`;
    if (!state.finalizations.read().has(key)) {
        state.finalizations.write(
            new Map([ ...state.finalizations.read(), [ key, finalizeInterval(state, interval) ] ])
        );
    }
    await state.finalizations.read().get(key);
}
async function finalizeAll(state: ObservationState, errors: StoredValue<readonly unknown[]>): Promise<void> {
    for (const snapshot of snapshots(state)) {
        if (snapshot.interval.kind === 'attempt') {
            await capture(state, async function () {
                await finalize(state, snapshot.interval);
            }, errors);
        }
    }
    await capture(state, async function () {
        await finalize(state, lifetime);
    }, errors);
}
async function disposeObservationInfrastructure(
    state: ObservationState,
    errors: StoredValue<readonly unknown[]>
): Promise<void> {
    try {
        await state.cleanup.disposeAsync();
    } catch (error: unknown) {
        errors.write([ ...errors.read(), error ]);
        state.ledger.writer.error(lifetime, null, error);
    }
}
async function closeOwner(state: ObservationState, dispose: Cleanup): Promise<void> {
    await Promise.resolve();
    const errors = createStoredValue<readonly unknown[]>([]);
    beginClosure(state);
    await capture(state, async function () {
        await prepare(state, lifetime);
    }, errors);
    await capture(state, dispose, errors);
    await finalizeAll(state, errors);
    await disposeObservationInfrastructure(state, errors);
    state.phase.write('closed');
    if (errors.read().length > 0) {
        throw new AggregateError(errors.read(), 'Resource observation closure failed.');
    }
}
async function close(state: ObservationState, dispose: Cleanup): Promise<void> {
    if (state.closure.read() === null) {
        state.closure.write(closeOwner(state, dispose));
    }
    await state.closure.read();
}
type ResourceCheckSessionControl = { readonly kind: 'managed'; readonly consumers: readonly WorkId[]; } | {
    readonly kind: 'standalone';
    readonly stop: (cause: unknown) => void;
};
type ObservationCancellation = {
    readonly phase: StoredValue<ResourceCheckPhase>;
    readonly scope: AnyResourceDefinition['scope'];
    readonly control: ResourceCheckSessionControl;
    readonly run: symbol;
};
function stopObservationLifetime(cancellation: ObservationCancellation, cause: unknown): void {
    const { control } = cancellation;
    if (control.kind === 'standalone') {
        control.stop(cause);
        return;
    }
    for (const work of control.consumers) {
        stopResourceCheckWork(work, cause, cancellation.run);
    }
}
function stopObservation(cancellation: ObservationCancellation, cause: unknown, interval: ResourceCheckInterval): void {
    const { phase } = cancellation;
    if (phase.read() !== 'installing' && phase.read() !== 'admitted') {
        return;
    }
    if (cancellation.scope === 'per-case' || interval.kind === 'lifetime') {
        phase.write('stopped');
    }
    if (interval.kind === 'attempt') {
        stopResourceCheckAttempt(interval.work, interval.attempt, cause, cancellation.run);
    } else {
        stopObservationLifetime(cancellation, cause);
    }
}
export function createResourceCheckSession(
    resource: AnyResourceDefinition,
    handle: unknown,
    control: ResourceCheckSessionControl
): ResourceCheckSession {
    const phase = createStoredValue<ResourceCheckPhase>('installing');
    const cancellation: ObservationCancellation = {
        phase,
        scope: resource.scope,
        control,
        run: resourceCheckRunIdentity()
    };
    const ledger = createResourceCheckLedger(resource.name, function stopOwner(cause, interval) {
        stopObservation(cancellation, cause, interval);
    });
    const state: ObservationState = {
        supervision: createResourceCheckSupervision(),
        lateCleanup: createStoredValue<readonly Promise<void>[]>([]),
        observations: createStoredValue<readonly ResourceCheckObservation[]>([]),
        cleanup: new AsyncDisposableStack(),
        controller: new AbortController(),
        finalizations: createStoredValue<ReadonlyMap<string, Promise<void>>>(new Map()),
        ledger,
        deadline: createStoredValue(Number.POSITIVE_INFINITY),
        phase,
        installation: createStoredValue<Promise<void> | null>(null),
        closure: createStoredValue<Promise<void> | null>(null),
        resource,
        handle
    };
    return {
        assertAdmitted() {
            assertAdmitted(state);
        },
        async install(signal) {
            await install(state, signal);
        },
        async prepare(interval) {
            await prepare(state, interval);
        },
        async finalize(interval) {
            await finalize(state, interval);
        },
        async close(dispose) {
            await close(state, dispose);
        },
        snapshots() {
            return snapshots(state);
        }
    };
}
