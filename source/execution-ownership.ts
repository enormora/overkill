import { AsyncLocalStorage } from 'node:async_hooks';
import type { AttemptId, CaseId, WorkId } from './engine/identity.ts';

export type ObservationLifetime = {
    readonly open: () => boolean;
    readonly close: () => void;
    readonly register: (dispose: () => void) => () => void;
};

export type RunOwner = ObservationLifetime & { readonly identity: symbol; };
export type AttemptOwner = ObservationLifetime & {
    readonly identity: symbol;
    readonly caseId: CaseId;
    readonly workId: WorkId;
    readonly attempt: AttemptId;
};

export type ObservationOwner = {
    readonly kind: 'attempt';
    readonly run: RunOwner;
    readonly attempt: AttemptOwner;
} | {
    readonly kind: 'infrastructure';
    readonly run: RunOwner | null;
} | {
    readonly kind: 'run';
    readonly run: RunOwner;
};

const observationKey = Symbol.for('@overkill-dev/engine/executionObservation');

function isObservationStorage(value: unknown): value is AsyncLocalStorage<ObservationOwner> {
    return value instanceof AsyncLocalStorage;
}

function sharedObservationStorage(): AsyncLocalStorage<ObservationOwner> {
    const existing: unknown = Reflect.get(globalThis, observationKey);
    if (isObservationStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<ObservationOwner>();
    Reflect.set(globalThis, observationKey, created);
    return created;
}

const ownership = sharedObservationStorage();

export function observingInfrastructure(): boolean {
    return ownership.getStore()?.kind === 'infrastructure';
}

export function currentAttemptIdentity(): symbol | null {
    const owner = ownership.getStore();
    if (owner?.kind !== 'attempt' || !owner.run.open() || !owner.attempt.open()) {
        return null;
    }
    const identity: unknown = Reflect.get(owner.attempt, 'identity');
    return typeof identity === 'symbol' ? identity : null;
}

export function registerExecutionDisposal(dispose: () => void): () => void {
    const run = ownership.getStore()?.run;
    if (run === null || run === undefined) {
        return function unregisterUnownedDisposal() {
            return undefined;
        };
    }
    return run.register(dispose);
}

export function withRunnerInfrastructure<Value>(operation: () => Value): Value {
    return ownership.run({ kind: 'infrastructure', run: ownership.getStore()?.run ?? null }, operation);
}

export function currentExecutionOwner(): ObservationOwner | undefined {
    return ownership.getStore();
}
export function withExecutionOwner<Value>(owner: ObservationOwner, operation: () => Value): Value {
    return ownership.run(owner, operation);
}
