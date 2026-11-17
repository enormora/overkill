import { randomUUID } from 'node:crypto';
import type { Clock } from '@enormora/clock';
import { match } from 'ts-pattern';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import { resourceCheckSnapshotKey } from '../resource-check-snapshot.ts';
import { workIdentityKey, type WorkId } from '../engine/identity.ts';
import { createStoredValue, type StoredValue } from '../stored-value.ts';
import type { ResourceCheckInterval, ResourceCheckOwner, ResourceCheckSnapshot } from '../resource-check-protocol.ts';
import type { ResourceCheckFrame } from './resource-check-channel.ts';

export type ResourceCheckConnection = { readonly destroyed: boolean; };
export type ResourceCheckSend = (frame: ResourceCheckFrame) => void;
type RegisteredOwner = {
    readonly owner: ResourceCheckOwner;
    readonly consumers: readonly WorkId[];
    readonly socket: ResourceCheckConnection;
    readonly send: ResourceCheckSend;
};
type PendingFinalization = {
    readonly socket: ResourceCheckConnection;
    readonly finish: (errors: readonly string[]) => void;
};
type Registry = {
    readonly clock: Clock;
    readonly run: string;
    readonly owners: OwnerRegistrations;
    readonly snapshots: Checkpoints;
    readonly stopped: StoppedOwners;
    readonly pending: Finalizations;
    readonly sends: Connections;
    readonly listener: StoredValue<(snapshot: ResourceCheckSnapshot) => void>;
};
const finalizationMilliseconds = 2000;
function consumes(owner: RegisteredOwner, work: WorkId): boolean {
    return owner.consumers.some(function matching(candidate) {
        return workIdentityKey(candidate) === workIdentityKey(work);
    });
}
function ownsInterval(owner: RegisteredOwner, interval: ResourceCheckInterval): boolean {
    return interval.kind === 'lifetime' || consumes(owner, interval.work);
}
function matchingAttempt(snapshot: ResourceCheckSnapshot, interval: ResourceCheckInterval): boolean {
    if (interval.kind !== 'attempt' || snapshot.interval.kind !== 'attempt') {
        return false;
    }
    return snapshot.interval.attempt.index === interval.attempt.index &&
        workIdentityKey(snapshot.interval.work) === workIdentityKey(interval.work);
}
function visibleTo(owner: RegisteredOwner, consumer: ResourceCheckConnection): boolean {
    const local = owner.owner.scope === 'per-case' || owner.owner.scope === 'shared-per-worker';
    return !local || owner.socket === consumer;
}
function visibleSnapshots(state: Registry, consumer: ResourceCheckConnection): readonly ResourceCheckSnapshot[] {
    return Array.from(state.snapshots.values()).filter(function visible(snapshot) {
        const owner = state.owners.get(snapshot.owner.id);
        return owner !== undefined && visibleTo(owner, consumer);
    });
}
function requiresFinalization(state: Registry, owner: RegisteredOwner, interval: ResourceCheckInterval): boolean {
    if (!ownsInterval(owner, interval)) {
        return false;
    }
    if (owner.owner.scope !== 'per-case') {
        return true;
    }
    return Array.from(state.snapshots.values()).some(function ownsSlice(snapshot) {
        return snapshot.owner.id === owner.owner.id && matchingAttempt(snapshot, interval);
    });
}
function register(
    state: Registry,
    socket: ResourceCheckConnection,
    send: ResourceCheckSend,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'register'; }>
): void {
    if (frame.owner.run !== state.run || state.owners.has(frame.owner.id)) {
        throw new Error('Invalid resource owner registration.');
    }
    state.owners.set(frame.owner.id, { owner: frame.owner, consumers: frame.consumers, socket, send });
    const snapshot: ResourceCheckSnapshot = {
        owner: frame.owner,
        resource: frame.resource,
        revision: 0,
        interval: { kind: 'lifetime' },
        passing: 0,
        failures: [],
        errors: [],
        status: { kind: 'open' }
    };
    state.snapshots.set(resourceCheckSnapshotKey(snapshot), snapshot);
    state.listener.read()(snapshot);
}
function ownerFor(
    state: Registry,
    socket: ResourceCheckConnection,
    id: string,
    interval: ResourceCheckInterval
): RegisteredOwner {
    const owner = state.owners.get(id);
    if (owner?.socket !== socket) {
        throw new Error('Resource owner channel mismatch.');
    }
    if (!ownsInterval(owner, interval)) {
        throw new Error('Resource check is outside the owner consumer set.');
    }
    return owner;
}
function checkpoint(state: Registry, socket: ResourceCheckConnection, snapshot: ResourceCheckSnapshot): void {
    const owner = ownerFor(state, socket, snapshot.owner.id, snapshot.interval);
    if (owner.owner.run !== snapshot.owner.run || owner.owner.scope !== snapshot.owner.scope) {
        throw new Error('Resource check execution mismatch.');
    }
    const key = resourceCheckSnapshotKey(snapshot);
    const previous = state.snapshots.get(key);
    if (previous !== undefined && previous.revision >= snapshot.revision) {
        return;
    }
    state.snapshots.set(key, snapshot);
    state.listener.read()(snapshot);
}
function stop(
    state: Registry,
    socket: ResourceCheckConnection,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'stop'; }>
): void {
    const owner = ownerFor(state, socket, frame.owner.id, frame.interval);
    if (frame.interval.kind === 'lifetime' || owner.owner.scope === 'per-case') {
        state.stopped.add(owner.owner.id);
    }
    const consumers = owner.consumers.filter(function affected(work) {
        return frame.interval.kind === 'lifetime' || workIdentityKey(work) === workIdentityKey(frame.interval.work);
    });
    for (const work of consumers) {
        const sends = Array.from(state.sends).filter(function affectedClient([ client ]) {
            return visibleTo(owner, client);
        });
        for (const [ , send ] of sends) {
            send({ kind: 'cancel', work, interval: frame.interval, cause: frame.cause });
        }
    }
}
async function finalizeOwner(
    state: Registry,
    owner: RegisteredOwner,
    interval: ResourceCheckInterval
): Promise<readonly string[]> {
    return new Promise(function awaitOwnerFinalization(resolve) {
        const request = randomUUID();
        const timer = withRunnerInfrastructure(function scheduleFinalization() {
            return state.clock.setTimeout(function finalizationExpired() {
                state.pending.delete(request);
                resolve([ 'Resource owner finalization acknowledgement timed out.' ]);
            }, finalizationMilliseconds);
        });
        state.pending.set(request, {
            socket: owner.socket,
            finish(errors) {
                state.clock.clearTimeout(timer);
                state.pending.delete(request);
                resolve(errors);
            }
        });
        owner.send({ kind: 'finalize-owner', request, owner: owner.owner, interval });
    });
}
async function finalize(
    state: Registry,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'finalize'; }>,
    socket: ResourceCheckConnection,
    send: ResourceCheckSend
): Promise<void> {
    const selected = Array.from(state.owners.values()).filter(function owning(owner) {
        return visibleTo(owner, socket) && requiresFinalization(state, owner, frame.interval);
    });
    const results = await Promise.all(selected.map(async function finish(owner) {
        return await finalizeOwner(state, owner, frame.interval);
    }));
    send({
        kind: 'result',
        request: frame.request,
        snapshots: visibleSnapshots(state, socket),
        errors: results.flat()
    });
}
function admit(
    state: Registry,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'admit'; }>,
    socket: ResourceCheckConnection,
    send: ResourceCheckSend
): void {
    const rejected = Array.from(state.owners.values()).some(function unavailable(owner) {
        return visibleTo(owner, socket) && ownsInterval(owner, frame.interval) &&
            (state.stopped.has(owner.owner.id) || owner.socket.destroyed);
    });
    send({
        kind: 'result',
        request: frame.request,
        snapshots: Array.from(state.snapshots.values()),
        errors: rejected ? [ 'Required resource owner is unavailable.' ] : []
    });
}
function finalized(
    state: Registry,
    socket: ResourceCheckConnection,
    frame: Extract<ResourceCheckFrame, { readonly kind: 'finalized'; }>
): void {
    const request = state.pending.get(frame.request);
    if (request?.socket === socket) {
        request.finish(frame.errors);
    }
}
async function receive(
    state: Registry,
    socket: ResourceCheckConnection,
    send: ResourceCheckSend,
    frame: ResourceCheckFrame
): Promise<void> {
    await match(frame)
        .with({ kind: 'register' }, function registerOwner(value) {
            register(state, socket, send, value);
        })
        .with({ kind: 'checkpoint' }, function retain(value) {
            checkpoint(state, socket, value.snapshot);
        })
        .with({ kind: 'stop' }, function stopConsumer(value) {
            stop(state, socket, value);
        })
        .with({ kind: 'finalized' }, function acknowledge(value) {
            finalized(state, socket, value);
        })
        .with({ kind: 'finalize' }, async function finish(value) {
            await finalize(state, value, socket, send);
        })
        .with({ kind: 'admit' }, function admission(value) {
            admit(state, value, socket, send);
        })
        .with({ kind: 'flush' }, function flush(value) {
            send({
                kind: 'result',
                request: value.request,
                snapshots: Array.from(state.snapshots.values()),
                errors: []
            });
        })
        .otherwise(function ignoreServerFrames() {
            return undefined;
        });
}
function interruptOwner(state: Registry, socket: ResourceCheckConnection, snapshot: ResourceCheckSnapshot): void {
    if (state.owners.get(snapshot.owner.id)?.socket !== socket || snapshot.status.kind !== 'open') {
        return;
    }
    const interrupted: ResourceCheckSnapshot = {
        ...snapshot,
        revision: snapshot.revision + 1,
        status: { kind: 'incomplete', reasons: [ 'Resource observation channel closed before finalization.' ] }
    };
    state.snapshots.set(resourceCheckSnapshotKey(snapshot), interrupted);
    state.listener.read()(interrupted);
}
function disconnect(state: Registry, socket: ResourceCheckConnection): void {
    state.sends.delete(socket);
    for (const snapshot of state.snapshots.values()) {
        interruptOwner(state, socket, snapshot);
    }
    for (const request of state.pending.values()) {
        if (request.socket === socket) {
            request.finish([ 'Resource observation channel closed.' ]);
        }
    }
}
export type ResourceCheckRegistry = {
    readonly snapshots: () => readonly ResourceCheckSnapshot[];
    readonly observe: (listener: (snapshot: ResourceCheckSnapshot) => void) => void;
    readonly connect: (socket: ResourceCheckConnection, send: ResourceCheckSend) => void;
    readonly disconnect: (socket: ResourceCheckConnection) => void;
    readonly receive: (
        socket: ResourceCheckConnection,
        send: ResourceCheckSend,
        frame: ResourceCheckFrame
    ) => Promise<void>;
};
export function createResourceCheckRegistry(run: string, clock: Clock): ResourceCheckRegistry {
    const state: Registry = {
        clock,
        run,
        owners: new Map(),
        snapshots: new Map(),
        stopped: new Set(),
        pending: new Map(),
        sends: new Map(),
        listener: createStoredValue<(snapshot: ResourceCheckSnapshot) => void>(function ignoreCheckpoint() {
            return undefined;
        })
    };
    return {
        snapshots() {
            return Array.from(state.snapshots.values());
        },
        observe(listener) {
            state.listener.write(listener);
        },
        connect(socket, send) {
            state.sends.set(socket, send);
        },
        disconnect(socket) {
            disconnect(state, socket);
        },
        async receive(socket, send, frame) {
            await receive(state, socket, send, frame);
        }
    };
}

type OwnerRegistrations = Map<string, RegisteredOwner>;

type Checkpoints = Map<string, ResourceCheckSnapshot>;

type StoppedOwners = Set<string>;

type Finalizations = Map<string, PendingFinalization>;

type Connections = Map<ResourceCheckConnection, ResourceCheckSend>;
