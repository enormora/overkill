# `@overkill-dev/assert`

Reusable assertion-extension helpers for Overkill.

Top-level API:

- `defineCompositeAssertion(options)`
- `defineNarrowingCompositeAssertion(options)`
- `CompositeCheckBuilder`
- `CompositeAssertionReference`
- `NarrowingCompositeAssertionReference`
- `CompositeAssertionReturn`
- `AssertReferenceArguments`
- `AssertReferenceReturn`
- `ThrownMatcher`, `ErrorMatcher`, `ExactThrownMatcher`

Composite assertions are imported reference values:

```ts
import { defineCompositeAssertion } from '@overkill-dev/assert';

export const resultValueDeepEqual = defineCompositeAssertion({
    name: 'resultValueDeepEqual',

    assert(check, result: { readonly ok: boolean; readonly value: unknown; }, expected: unknown) {
        return check.group([
            check.annotated('ok flag').true(result.ok),
            check.annotated('value').deepEqual(result.value, expected)
        ]);
    }
});
```

Tests pass references to the engine-owned assertion facade:

```ts
scope.assert(resultValueDeepEqual, result, expected);
```

`defineNarrowingCompositeAssertion(...)` creates synchronous references accepted by both `scope.assert(...)` and `scope.require(...)`.

Foreign throwable-style assertions can be bridged inside a composite assertion:

```ts
export const hasDomainInvariant = defineCompositeAssertion({
    name: 'hasDomainInvariant',

    assert(check, value: unknown) {
        return check.fromThrowable('domain.assertInvariant', () => {
            assertDomainInvariant(value);
        });
    }
});
```

Each composite reference records one assertion boundary. Injected child checks
capture their own verdict and diagnostics at the call or settlement. The
composite captures its parent diagnostic operands at completion.

Injected foreign bridges serialize arbitrary thrown values within the assertion
budget. Live failed checks expose that value as `error.thrown` with
`error.thrownEncoding: 'serialized'`.

Error assertions and foreign bridges propagate engine control signals unchanged.

An injected `check` builder and its diagnostics belong to one custom assertion
invocation. Await its async checks before returning a child or group. Authors
can await multiple custom assertions together before collecting the case
assertions. Each invocation contributes one assertion to the plan.
