import { AsyncLocalStorage } from 'node:async_hooks';
import { withRunnerInfrastructure } from '../execution-ownership.ts';
import type { RunnerError } from './run-result.ts';

type LateAssertionSink = (error: RunnerError) => void;

export type LateAssertionDelivery = {
    readonly take: () => readonly RunnerError[];
    readonly seal: () => readonly RunnerError[];
};

const delivery = new AsyncLocalStorage<LateAssertionSink>();
const fallbackKey = Symbol.for('@overkill-dev/late-assertion-fallback/v1');

function isFallbackStorage(value: unknown): value is AsyncLocalStorage<LateAssertionSink> {
    return value instanceof AsyncLocalStorage;
}

function sharedFallbackDelivery(): AsyncLocalStorage<LateAssertionSink> {
    const existing: unknown = Reflect.get(globalThis, fallbackKey);
    if (isFallbackStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<LateAssertionSink>();
    Object.defineProperty(globalThis, fallbackKey, { value: created });
    return created;
}

const fallbackDelivery = sharedFallbackDelivery();

function warnLateAssertion(error: RunnerError): void {
    withRunnerInfrastructure(function warn() {
        process.emitWarning(`${error.message} ${error.diagnostics[0]?.value ?? ''}`, {
            code: 'OVERKILL_LATE_ASSERTION_ACTIVITY'
        });
    });
}

export function currentLateAssertionSink(): LateAssertionSink {
    return delivery.getStore() ?? warnLateAssertion;
}

export async function withLateAssertionDelivery<Value>(
    run: (events: LateAssertionDelivery) => Promise<Value>
): Promise<Value> {
    const fallback = fallbackDelivery.getStore() ?? warnLateAssertion;
    let pending: RunnerError[] = [];
    let open = true;
    function take(): readonly RunnerError[] {
        const events = pending;
        pending = [];
        return events;
    }
    return await delivery.run(function receive(error) {
        if (open) {
            pending.push(error);
        } else {
            fallback(error);
        }
    }, async function runWithDelivery() {
        try {
            return await run({
                take,
                seal() {
                    open = false;
                    return take();
                }
            });
        } finally {
            open = false;
            take().forEach(fallback);
        }
    });
}

export async function withLateAssertionFallback<Value>(
    sink: LateAssertionSink,
    run: () => Promise<Value>
): Promise<Value> {
    return await fallbackDelivery.run(sink, run);
}
