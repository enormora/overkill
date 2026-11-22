import { createClock } from '@enormora/clock';
import { createInvocationBudget, InvocationDeadlineExceededError } from '../invocation-budget.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FamilyValue } from '../engine/test-family.ts';

const invocation = new AsyncLocalStorage<AbortSignal>();
const collection = new AsyncLocalStorage<FamilyValue | undefined>();
const idle = new AbortController();

export function analysisSignal(): AbortSignal {
    return invocation.getStore() ?? idle.signal;
}

export function withAnalysisSignal<Value>(signal: AbortSignal, operation: () => Value): Value {
    return invocation.run(signal, operation);
}

export function expectedAnalysisCollection(): FamilyValue | undefined {
    return collection.getStore();
}

export function withAnalysisCollection<Value>(facts: FamilyValue | undefined, operation: () => Value): Value {
    return collection.run(facts, operation);
}

export async function withAnalysisDeadline<Value>(
    milliseconds: number,
    message: string,
    operation: (signal: AbortSignal) => Promise<Value>
): Promise<Value> {
    const budget = createInvocationBudget(milliseconds, analysisSignal(), createClock());
    const controller = new AbortController();
    function abort(): void {
        const reason: unknown = budget.signal.reason;
        controller.abort(
            reason instanceof InvocationDeadlineExceededError
                ? new DOMException(message, 'TimeoutError')
                : reason
        );
    }
    budget.signal.addEventListener('abort', abort, { once: true });
    if (budget.signal.aborted) {
        abort();
    }
    try {
        return await operation(controller.signal);
    } finally {
        budget.signal.removeEventListener('abort', abort);
        budget.dispose();
    }
}
