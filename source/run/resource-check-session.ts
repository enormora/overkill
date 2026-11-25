import { randomUUID } from 'node:crypto';
import type { Clock } from '@enormora/clock';
import { match } from 'ts-pattern';
import { workIdentityKey } from '../engine/identity.ts';
import { serializeValue } from '../compare/serialized-value.ts';
import type { ResourceCheckDelivery } from '../resource-check-delivery.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { ResourceCheckInterval, ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import type { ResourceCheckFrame } from './resource-check-channel.ts';
import { serializeResourceCheckSnapshot } from './resource-check-serialization.ts';

export type ResourceCheckConnection = {
    readonly destroyed: boolean;
    readonly destroy: () => unknown;
    readonly ref: () => unknown;
    readonly unref: () => unknown;
};
export type ResourceCheckResponse = Extract<ResourceCheckFrame, { readonly kind: 'result'; }>;
export type ResourceCheckRequest = Extract<ResourceCheckFrame, { readonly kind: 'admit' | 'finalize' | 'flush'; }>;
type Consumer = {
    readonly interval: Extract<ResourceCheckInterval, { readonly kind: 'attempt'; }>;
    readonly cancel: (cause: unknown) => void;
};
type Finalize = (interval: ResourceCheckInterval) => Promise<void>;
type Send = (frame: ResourceCheckFrame) => void;
type Pending = { readonly resolve: (result: ResourceCheckResponse) => void; readonly reject: (error: Error) => void; };
type ClientState = {
    readonly socket: ResourceCheckConnection;
    readonly clock: Clock;
    readonly finalizers: OwnerFinalizers;
    readonly active: ActiveConsumers;
    readonly pending: PendingRequests;
    readonly send: StoredValue<Send>;
};

const acknowledgementMilliseconds = 2500;
function failPending(state: ClientState): void {
    for (const request of state.pending.values()) {
        request.reject(new Error('Resource observation channel closed.'));
    }
    state.pending.clear();
    for (const consumer of state.active.values()) {
        consumer.cancel(new Error('Required resource observation was lost.'));
    }
}
async function finalize(
    state: ClientState,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'finalize-owner'; }>
): Promise<void> {
    const operation = state.finalizers.get(frame.owner.id);
    if (operation === undefined) {
        throw new Error('Resource owner is unavailable.');
    }
    await operation(frame.interval);
}
async function acknowledgeOwner(
    state: ClientState,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'finalize-owner'; }>
): Promise<void> {
    const results = await Promise.allSettled([ finalize(state, frame) ]);
    const errors = results.flatMap(function error(result) {
        return result.status === 'rejected'
            ? [ result.reason instanceof Error ? result.reason.message : String(result.reason) ]
            : [];
    });
    state.send.read()({ kind: 'finalized', request: frame.request, errors });
}
function matchesConsumer(
    consumer: Consumer,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'cancel'; }>
): boolean {
    if (workIdentityKey(consumer.interval.work) !== workIdentityKey(frame.work)) {
        return false;
    }
    return frame.interval.kind === 'lifetime' || consumer.interval.attempt.index === frame.interval.attempt.index;
}
function cancel(state: ClientState, frame: Extract<ResourceCheckFrame, { readonly kind: 'cancel'; }>): void {
    for (const consumer of state.active.values()) {
        if (matchesConsumer(consumer, frame)) {
            consumer.cancel(frame.cause);
        }
    }
}
async function receiveOwnerFinalization(
    state: ClientState,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'finalize-owner'; }>
): Promise<void> {
    try {
        await acknowledgeOwner(state, frame);
    } catch {
        state.socket.destroy();
    }
}
async function receive(state: ClientState, frame: ResourceCheckFrame): Promise<void> {
    await match(frame)
        .with({ kind: 'result' }, function resolve(value) {
            state.pending.get(value.request)?.resolve(value);
        })
        .with({ kind: 'finalize-owner' }, async function finish(value) {
            return receiveOwnerFinalization(state, value);
        })
        .with({ kind: 'cancel' }, function stop(value) {
            cancel(state, value);
        })
        .otherwise(function ignoreClientFrames() {
            return undefined;
        });
}
function checkpoint(state: ClientState, snapshot: ResourceCheckSnapshot): void {
    try {
        state.send.read()({ kind: 'checkpoint', snapshot: serializeResourceCheckSnapshot(snapshot) });
    } catch {
        state.socket.destroy();
    }
}
type TrackedRequest = {
    readonly result: Promise<ResourceCheckResponse>;
    readonly reject: (error: unknown) => void;
    readonly close: () => void;
};
function trackRequest(state: ClientState, frame: ResourceCheckRequest): TrackedRequest {
    if (state.socket.destroyed) {
        throw new Error('Resource observation channel closed.');
    }
    const completed = Promise.withResolvers<ResourceCheckResponse>();
    const timer = withRunnerInfrastructure(function scheduleAcknowledgement() {
        return state.clock.setTimeout(function expireRequest() {
            completed.reject(new Error('Resource observation acknowledgement timed out.'));
        }, acknowledgementMilliseconds);
    });
    state.pending.set(frame.request, completed);
    state.socket.ref();
    return {
        result: completed.promise,
        reject: completed.reject,
        close() {
            state.clock.clearTimeout(timer);
            state.pending.delete(frame.request);
            state.socket.unref();
        }
    };
}
function sendResourceRequest(state: ClientState, frame: ResourceCheckRequest, request: TrackedRequest): void {
    try {
        state.send.read()(frame);
    } catch (error: unknown) {
        request.reject(error);
    }
}
async function exchange(state: ClientState, frame: ResourceCheckRequest): Promise<ResourceCheckResponse> {
    const request = trackRequest(state, frame);
    try {
        sendResourceRequest(state, frame, request);
        return await request.result;
    } finally {
        request.close();
    }
}
function delivery(state: ClientState, run: string): ResourceCheckDelivery {
    return {
        kind: 'transport',
        run,
        async flush() {
            await exchange(state, { kind: 'flush', request: randomUUID() });
        },
        register(owner, resource, consumers, operation) {
            state.finalizers.set(owner.id, operation);
            state.send.read()({ kind: 'register', owner, resource, consumers });
        },
        checkpoint(snapshot) {
            checkpoint(state, snapshot);
        },
        stop(owner, interval, cause) {
            state.send.read()({ kind: 'stop', owner, interval, cause: serializeValue(cause) });
        },
        active(interval, abort) {
            const key = JSON.stringify([ workIdentityKey(interval.work), interval.attempt.index ]);
            state.active.set(key, { interval, cancel: abort });
            return function releaseConsumer() {
                state.active.delete(key);
            };
        }
    };
}

export type ResourceCheckSession = {
    readonly delivery: ResourceCheckDelivery;
    readonly exchange: (frame: ResourceCheckRequest) => Promise<ResourceCheckResponse>;
    readonly receive: (frame: ResourceCheckFrame) => Promise<void>;
    readonly connect: (send: Send) => void;
    readonly disconnected: () => void;
};
export function createResourceCheckSession(
    run: string,
    socket: ResourceCheckConnection,
    clock: Clock
): ResourceCheckSession {
    const state: ClientState = {
        socket,
        clock,
        finalizers: new Map(),
        active: new Map(),
        pending: new Map(),
        send: createStoredValue<Send>(function disconnected() {
            throw new Error('Resource channel is not connected.');
        })
    };
    return {
        delivery: delivery(state, run),
        async exchange(frame) {
            return await exchange(state, frame);
        },
        async receive(frame) {
            await receive(state, frame);
        },
        connect(send) {
            state.send.write(send);
        },
        disconnected() {
            failPending(state);
        }
    };
}
type OwnerFinalizers = Map<string, Finalize>;
type ActiveConsumers = Map<string, Consumer>;
type PendingRequests = Map<string, Pending>;
