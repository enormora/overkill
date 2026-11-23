type AssertionBodyExecutor = <Value>(body: () => Promise<Value> | Value) => Promise<Value>;

const bodyExecutor = Symbol.for('@overkill-dev/assertion-body-execution/v1');

export function attachAssertionBodyExecutor<Scope extends Readonly<Record<string, unknown>>>(scope: Scope, execute: AssertionBodyExecutor): Scope {
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
