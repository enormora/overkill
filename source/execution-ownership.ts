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

function isExecutionStorage<Value>(value: unknown): value is AsyncLocalStorage<Value> {
    return value instanceof AsyncLocalStorage;
}

export function sharedExecutionStorage<Value>(key: symbol): AsyncLocalStorage<Value> {
    const existing: unknown = Reflect.get(globalThis, key);
    if (isExecutionStorage<Value>(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<Value>();
    Reflect.set(globalThis, key, created);
    return created;
}

const ownership = sharedExecutionStorage<ObservationOwner>(observationKey);

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

export type RunIdentity = { readonly id: string; readonly startedAt: string; };
const runIdentities = sharedExecutionStorage<RunIdentity>(Symbol.for('@overkill-dev/run/identity'));
export function currentRunIdentity(): RunIdentity | null {
    return runIdentities.getStore() ?? null;
}
export function withRunIdentity<Value>(identity: RunIdentity, operation: () => Value): Value {
    return runIdentities.run(identity, operation);
}

type AssertionBodyExecutor = <Value>(body: () => Promise<Value> | Value) => Promise<Value>;

const bodyExecutor = Symbol.for('@overkill-dev/assertion-body-execution/v1');

export function attachAssertionBodyExecutor<Scope extends Readonly<Record<string, unknown>>>(
    scope: Scope,
    execute: AssertionBodyExecutor
): Scope {
    return Object.assign(scope, { [bodyExecutor]: execute });
}

function isAssertionBodyExecutor(value: unknown): value is AssertionBodyExecutor {
    return typeof value === 'function';
}

export function runScopedAssertionBody<Value>(
    scope: unknown,
    body: () => Promise<Value> | Value
): Promise<Value> | Value {
    if (typeof scope !== 'object' || scope === null) {
        return body();
    }
    const execute: unknown = Reflect.get(scope, bodyExecutor);
    return isAssertionBodyExecutor(execute) ? execute(body) : body();
}
