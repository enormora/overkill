import { AsyncLocalStorage } from 'node:async_hooks';
import { defaultSerializationBudget, type SerializationBudget } from './serialized-value-shape.ts';

const budgetKey = Symbol.for('@overkill-dev/serialization-budget/v1');

function isBudgetStorage(value: unknown): value is AsyncLocalStorage<SerializationBudget> {
    return value instanceof AsyncLocalStorage;
}

function sharedBudgetStorage(): AsyncLocalStorage<SerializationBudget> {
    const existing: unknown = Reflect.get(globalThis, budgetKey);
    if (isBudgetStorage(existing)) {
        return existing;
    }
    const created = new AsyncLocalStorage<SerializationBudget>();
    Object.defineProperty(globalThis, budgetKey, { value: created });
    return created;
}

const budgets = sharedBudgetStorage();

export function currentSerializationBudget(): SerializationBudget {
    return budgets.getStore() ?? defaultSerializationBudget;
}

export function withSerializationBudget<Value>(budget: SerializationBudget, operation: () => Value): Value {
    return budgets.run(budget, operation);
}
