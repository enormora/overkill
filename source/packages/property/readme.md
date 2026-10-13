# `@overkill-dev/property`

Property test authoring. Included in `@overkill-dev/test` through its
`@overkill-dev/test/property` subpath.

## Authoring

`property({ title, generator, test })` creates one property-family `TestCase`,
usable directly or inside `suite(...)`. Its callback receives the generated
value and a property-local assertion scope, and returns an `AssertionResult`.

`withProperties(body)` wraps an ordinary test body with typed
`scope.forall(generator, body)` authoring. Nested invocations stay inside the
enclosing case; they never register runtime subtests. Rewrapping preserves the
original nested declaration. Base test scopes have no `forall` method.

Generator values are owned by Overkill. Custom generators compose its fluent
`map`, `flatMap`, `filter`, and `withCodec` surfaces. Sampling callbacks and
unbranded objects are not generators.
Their private runtime symbol and shared declaration identity remain compatible
across leaf and standard package copies.

## Current availability

Construction and collection are supported. They retain generator and callback
declarations without executing them. Generator constructors, property profiles,
and trial execution are not implemented yet. Executing a property declaration
fails explicitly before user callbacks or resource acquisition.

The standard subpath exposes the same authoring functions and types as this
package. Property modules stay outside the root test import and ordinary
microtest startup.
