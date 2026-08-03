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

Each composite reference records one assertion boundary. Child checks created through `check.*` are grouped diagnostics, not extra plan units.
