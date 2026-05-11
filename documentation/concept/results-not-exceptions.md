# Results, Not Exceptions

## Purpose

This document is no longer the primary place to learn Overkill's assertion
API. That role belongs to [`assertions-and-results.md`](./assertions-and-results.md).

This file now has one narrower job:

-   explain **why** Overkill still cares about returned structured outcomes
-   explain what that means for the **engine and protocol layer**
-   preserve the rationale for supporting value-oriented authoring modes such
    as [`tests-as-values.md`](./tests-as-values.md)

## Position

Overkill's primary end-user DX is the injected builder API:

-   `assert`
-   `require`
-   `plan()`
-   explicit `return assert.done()`

That decision is settled.

Underneath that API, Overkill still benefits from a result-oriented protocol:

-   low-level assertions can be represented as `AssertionNode` values
-   the engine can normalize both builder mode and `throwingTest` into one
    structured `TestOutcome`
-   reporters, IDEs, MCP servers, and remote executors consume structured
    data instead of parsing prose

So "results, not exceptions" is now the **protocol-layer principle**, not
the main user-facing syntax. It is the engine-side expression of
[Principles § Data Over Side Effects](./principles.md#data-over-side-effects): outcomes flow as structured
values between layers, even when the user-facing API is the injected
builder.

## Why The Protocol Matters

Mainstream JS runners usually treat assertion failure as the normal
exception path. That has several costs:

-   the success path still depends on exception-oriented machinery
-   stack walking becomes part of ordinary failure rendering
-   machine-readable integrations must reconstruct meaning from error objects
    and strings
-   "test failed" and "runner could not execute the test correctly" are easy
    to muddle together

Overkill's structured outcome model avoids that at the architectural level.

## The Protocol Shape

The engine should treat structured outcomes as canonical:

```ts
// engine-level outcome; reporter-facing verdicts (xfail, xpass,
// crashed) are derived from outcome + metadata + runner-error state
// — see `glossary.md` § Test Outcome / Test Verdict.
type TestOutcome = Pass | Fail | Skip | Inconclusive;

type Pass = { kind: 'pass' };

type Fail = {
    kind: 'fail';
    checks: ReadonlyArray<FailedCheck>;
};

type Skip = {
    kind: 'skip';
    reason: string;
};

type Inconclusive = {
    kind: 'inconclusive';
    reason: string;
};
```

Low-level assertion constructors return `AssertionNode` values that can be
combined into those outcomes. Builder-style tests record those nodes
implicitly and finalize them through `assert.done()`.

That gives Overkill one canonical internal representation even though the
surface authoring styles differ.

## Relationship To Builder Mode

Builder mode remains the preferred surface because it solves practical
TypeScript problems:

-   `require.*` can narrow types
-   straight-line async code stays ergonomic
-   `plan()` and zero-assertion detection are explicit test-local state
-   common tests do not need to manually assemble assertion trees

The key architectural point is that builder mode does **not** invalidate the
underlying result-oriented protocol. It is simply a friendlier way to
produce it.

## Relationship To Throwing Mode

`throwingTest` is still supported, but it should normalize into the same
structured result shape.

That means:

-   the engine still exposes one machine-readable `TestOutcome` model
-   reporters still consume one structured failure shape
-   throwing mode is an alternate authoring style, not a second reporting
    system

## Where Returned Values Still Matter Directly

There are still cases where explicit returned values are a strong fit:

-   tests-as-values
-   property-based or relational checks
-   reusable low-level assertion combinators
-   future experimental assertion DSLs

Example:

```ts
import { assertion } from '@overkill/assert';

function validUser(user: User) {
    return assertion.all([assertion.string(user.id), assertion.string(user.name), assertion.array(user.roles)]);
}
```

This is not the default day-to-day style, but it is a valuable capability to
preserve.

## Error Separation

The protocol model also sharpens an important distinction:

-   **assertion failure** — structured test outcome
-   **runner error** — unexpected exception, rejection, crash, permission
    denial, or runtime failure

This separation is part of the core concept. Assertion failures should not
need to travel through the same path as infrastructure errors.

See:

-   [`failure-artifacts.md`](./failure-artifacts.md)
-   [`runtime-behavior.md`](./runtime-behavior.md)

## Why This Still Fits The Engine

The narrow `@overkill/engine` should stay flexible enough to support:

-   builder/context authoring
-   explicit throwing mode
-   value-oriented suite trees and test nodes
-   future packages that need compositional result values

That is why the engine should continue to "speak" structured outcomes
natively, even though the default human-facing authoring experience is no
longer pure returned-value assertions.

## Current Role In The Concept

The settled split is:

-   [`assertions-and-results.md`](./assertions-and-results.md)
    -   canonical user-facing assertion model
    -   `assert` / `require` / `plan()`
    -   `AssertionNode`
    -   `throwingTest`
-   [`results-not-exceptions.md`](./results-not-exceptions.md)
    -   protocol-layer rationale
    -   structured outcome motivation
    -   why the engine should preserve value-oriented semantics internally

That is the intended consolidation boundary.

## Influences

-   `elm-test` — expectations as values
-   ZIO Test — assertions as values
-   ScalaCheck — properties as values
-   Rust — coexistence of alternate test-result styles

## Sources

-   [elm-test — `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
-   [ZIO Test — Why ZIO Test](https://zio.dev/reference/test/why-zio-test/)
-   [ScalaCheck — Properties](https://scalacheck.org/documentation.html)
-   [Rust by Example — Unit testing with `Result`](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
