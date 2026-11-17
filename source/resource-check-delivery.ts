import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { currentExecutionOwner, type RunOwner } from './execution-ownership.ts';
import type { ResourceCheckInterval, ResourceCheckOwner, ResourceCheckSnapshot } from './resource-check-protocol.ts';
import type { WorkId } from './engine/identity.ts';

export type ResourceCheckDelivery = {
    readonly kind: 'execution' | 'transport';
    readonly run: string;
    readonly flush: () => Promise<void>;
    readonly register: (
        owner: ResourceCheckOwner,
        resource: string,
        consumers: readonly WorkId[],
        finalize: (interval: ResourceCheckInterval) => Promise<void>
    ) => void;
    readonly checkpoint: (snapshot: ResourceCheckSnapshot) => void;
    readonly stop: (owner: ResourceCheckOwner, interval: ResourceCheckInterval, cause: unknown) => void;
    readonly active: (
        interval: Extract<ResourceCheckInterval, { readonly kind: 'attempt'; }>,
        cancel: (cause: unknown) => void
    ) => () => void;
};
type ResourceCheckExecutionContext = {
    readonly deliveries: AsyncLocalStorage<ResourceCheckDelivery | null>;
    readonly runs: AsyncLocalStorage<string>;
    readonly identities: WeakMap<RunOwner, string>;
};
const contextKey = Symbol.for('@overkill-dev/resource-checks/execution-context/v1');
function isExecutionContext(value: unknown): value is ResourceCheckExecutionContext {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const deliveryContext: unknown = Reflect.get(value, 'deliveries');
    const runContext: unknown = Reflect.get(value, 'runs');
    const identities: unknown = Reflect.get(value, 'identities');
    return deliveryContext instanceof AsyncLocalStorage && runContext instanceof AsyncLocalStorage &&
        identities instanceof WeakMap;
}
function sharedExecutionContext(): ResourceCheckExecutionContext {
    const existing: unknown = Reflect.get(globalThis, contextKey);
    if (isExecutionContext(existing)) {
        return existing;
    }
    const context: ResourceCheckExecutionContext = {
        deliveries: new AsyncLocalStorage(),
        runs: new AsyncLocalStorage(),
        identities: new WeakMap()
    };
    Object.defineProperty(globalThis, contextKey, { value: context });
    return context;
}
const context = sharedExecutionContext();
const { deliveries } = context;
export function currentResourceCheckDelivery(): ResourceCheckDelivery | null {
    return deliveries.getStore() ?? null;
}
export function withResourceCheckDelivery<Value>(delivery: ResourceCheckDelivery, operation: () => Value): Value {
    return deliveries.run(delivery, operation);
}

const { runs } = context;
const executionRuns = context.identities;

export function resourceCheckExecutionRunId(): string {
    const run = currentExecutionOwner()?.run;
    if (run === null || run === undefined) {
        return randomUUID();
    }
    const existing = executionRuns.get(run);
    if (existing !== undefined) {
        return existing;
    }
    const id = randomUUID();
    executionRuns.set(run, id);
    return id;
}

function resourceCheckRunId(): string {
    return currentResourceCheckDelivery()?.run ?? runs.getStore() ?? resourceCheckExecutionRunId();
}

export function createResourceCheckOwner(scope: ResourceCheckOwner['scope']): ResourceCheckOwner {
    return Object.freeze({ run: resourceCheckRunId(), id: randomUUID(), scope });
}

export function withStandaloneResourceChecks<Value>(operation: () => Value): Value {
    return runs.run(randomUUID(), function standaloneRun() {
        return deliveries.run(null, operation);
    });
}
