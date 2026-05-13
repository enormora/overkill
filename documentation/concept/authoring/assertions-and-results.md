# Assertions And Results

## The Problem

Overkill needs a result model that is:

-   simple enough for the core
-   rich enough for integrations
-   flexible enough for assertion tracking
-   structured enough that reporters and IDEs do not parse prose

## Baseline Outcome Contract

The core accepts two first-party styles:

-   **builder/result mode** — the primary concept; tests receive injected
    `case.assert`, `case.require`, and `case.plan`, and must explicitly
    return `case.assert.done()`
-   **throwing mode** — an explicit alternate test API such as
    `throwingTest`; tests may return `void`

Both produce the same internal `TestOutcome` value.

Sources:

-   [Rust by Example — Unit testing with `Result`](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
-   [elm-test — `Test` and `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Test)

## Why A First-Party Assertion Package Still Makes Sense

Assertion tracking is hard to do well if assertions are entirely external.
A first-party assertion package offers a clean place to provide:

-   assertion count tracking
-   `plan()`-style guarantees
-   zero-assertion detection (see policy below)
-   rich diffs and mismatch metadata
-   baseline-aware serializers

Most tests should not need to import `@overkill/assert` directly. The main
user-facing API comes from `@overkill/test` context injection. The package
still makes sense as the home of:

-   the `AssertionNode` protocol
-   low-level `assertion.*` constructors for advanced composition
-   diffing and serializer logic
-   implementation shared between `@overkill/assert` and `@overkill/test`

## Zero-Assertion Detection As Default Failure

A test that runs to completion without performing any assertion is a
**failure** by default. AVA pioneered this convention in JS, and it is the
correct default: a test that asserts nothing is either incomplete, broken,
or a placeholder. Treating it as a pass quietly hides defects.

Default policy:

-   if a test body records no assertion at all, the runner reports it as
    `fail` with reason `no-assertions`
-   there is no `plan(0, ...)` escape hatch in the current concept; plans
    should describe a positive number of checks
-   tests that perform side-effect-only work and assert via the recorded
    effect log are _not_ zero-assertion: the equality check on the
    recorded log is itself an assertion

There is no opt-out. A test that asserts nothing is broken; the
default policy is the only policy. This is one of the smallest changes
that materially raises the floor on test quality, and it costs nothing
to implement.

## `plan(n)` Definition

`plan` declares the expected number of leaf assertions in a test:

```ts
test('parses three rows', (case) => {
    case.plan(3);
    const rows = parse(input);
    case.assert.length(rows, 3);
    case.assert.equal(rows[0].id, 1);
    case.assert.equal(rows[1].id, 2);
    return case.assert.done();
});
```

Semantics:

-   `plan(n)` must be the first call in the test body. Calling it after any
    `assert.*` or `require.*` invocation, or calling it more than once, is a
    test error
-   `n` must be greater than `0`
-   the test must record exactly `n` leaf assertions before completion
-   both more and fewer fail
-   if the test never returns, timeout or crash handling applies instead

This is explicit context injection, not hidden global mutable state.

## Property Tests And The Assertion Boundary

Property primitives like `case.forall(gen, body)` (proposed package
`@overkill/property`) call `body` many times — once per generated
input — but count as **one assertion at the boundary** for both
zero-assertion detection and `plan(n)`:

-   on success: `case.forall` records one assertion's worth of
    activity in the case's log; a property test that completes
    successfully therefore satisfies § Zero-Assertion Detection
    without forcing the author to write `case.plan(1)`
-   on failure: `case.forall` records exactly one `FailedCheck` for
    the shrunk minimal counterexample, regardless of how many failing
    inputs were seen during shrinking
-   `plan(n)` counts boundary assertions: a test with one
    `case.forall` call satisfies `case.plan(1)`; a test with two
    `case.forall` calls satisfies `case.plan(2)`

The body passed to `case.forall` typically uses pure assertion-node
constructors from `@overkill/assert` (e.g.
`assertion.equal(actual, expected) -> AssertionNode`) rather than
`case.assert.*` — the body's return value feeds the property
machinery, which decides what to record at the boundary. See
[Tests As Values § Macros And Parameterized Tests](./tests-as-values.md#macros-and-parameterized-tests) for the
canonical authoring shape, and [Failure Walkthrough](./failure-walkthrough.md) for an
end-to-end walked example.

The same boundary rule applies to other property-like primitives
(`relation`, `differential`, `hyperproperty`) when they land: each
counts as one boundary assertion regardless of internal iteration.

## Protocol Layer: Structured Outcomes

The user-facing API is the injected builder, but underneath that API
Overkill speaks a result-oriented protocol. "Results, not exceptions" is
the engine-side expression of
[Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects):
outcomes flow as structured values between layers, even when the
authoring style is the injected builder.

### Why The Protocol Matters

Mainstream JS runners treat assertion failure as the normal exception
path. That has several costs:

-   the success path still depends on exception-oriented machinery
-   stack walking becomes part of ordinary failure rendering
-   machine-readable integrations must reconstruct meaning from error
    objects and strings
-   "test failed" and "runner could not execute the test correctly" are
    easy to muddle together

Overkill's structured outcome model avoids that at the architectural
level. Reporters, IDEs, MCP servers, and remote executors consume
structured data instead of parsing prose.

### The Protocol Shape

The engine treats structured outcomes as canonical:

```ts
// engine-level outcome; reporter-facing verdicts (xfail, xpass,
// crashed) are derived from outcome + metadata + runner-error state
// — see Glossary § Test Outcome / Test Verdict.
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

Low-level assertion constructors return `AssertionNode` values that can
be combined into those outcomes. Builder-style tests record those nodes
implicitly and finalize them through `case.assert.done()`. That gives
Overkill one canonical internal representation even though the surface
authoring styles differ.

### Builder Mode And Throwing Mode

Builder mode is the preferred surface because it solves practical
TypeScript problems:

```ts
test('user shape', (case) => {
    case.require.defined(user);
    case.assert.equal(user.name, 'Ada');
    return case.assert.done();
});
```

-   `assert.*` records ordinary assertions
-   `require.*` records gating assertions and short-circuits on failure;
    `require` exists because TypeScript narrowing matters in
    straight-line tests

Builder mode does not invalidate the underlying result-oriented
protocol — it is simply a friendlier way to produce it. `throwingTest`
remains a supported alternate authoring style, but the engine
normalizes its result into the same structured `TestOutcome` shape so
reporters consume one failure model.

### Where Returned Values Still Matter Directly

The low-level `@overkill/assert` package still exposes:

-   `assertion.equal(...) -> AssertionNode`
-   `assertion.all(...) -> AssertionNode`
-   other low-level node constructors for advanced composition

These remain useful in cases where explicit returned values are a strong
fit:

-   tests-as-values
-   property-based or relational checks
-   reusable low-level assertion combinators
-   future experimental assertion DSLs

```ts
import { assertion } from '@overkill/assert';

function validUser(user: User) {
    return assertion.all([assertion.string(user.id), assertion.string(user.name), assertion.array(user.roles)]);
}
```

This is not the default day-to-day style, but it is a valuable
capability to preserve.

### Error Separation

The protocol model sharpens an important distinction:

-   **assertion failure** — structured test outcome
-   **runner error** — unexpected exception, rejection, crash, permission
    denial, or runtime failure

This separation is part of the core concept. Assertion failures should
not need to travel through the same path as infrastructure errors. See
[Failure Artifacts](./failure-artifacts.md) and
[Runtime Behavior](../architecture/runtime-behavior.md).

### Engine Flexibility

The narrow `@overkill/engine` stays flexible enough to support:

-   builder/context authoring
-   explicit throwing mode
-   value-oriented suite trees and test nodes
-   future packages that need compositional result values

That is why the engine continues to speak structured outcomes natively,
even though the default human-facing authoring experience is no longer
pure returned-value assertions.

### Influences

-   `elm-test` — expectations as values
-   ZIO Test — assertions as values
-   ScalaCheck — properties as values
-   Rust — coexistence of alternate test-result styles

Sources:

-   [elm-test — `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
-   [ZIO Test — Why ZIO Test](https://zio.dev/reference/test/why-zio-test/)
-   [ScalaCheck — Properties](https://scalacheck.org/documentation.html)
-   [Rust by Example — Unit testing with `Result`](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)

## `assert` Versus `require`

This split should be explicit in the docs.

`assert`:

-   records an assertion
-   returns `void` in the builder API
-   does not short-circuit the test body on failure
-   is suitable for the ordinary “check and continue” path

`require`:

-   records a gating assertion
-   supports narrowing-style APIs such as
    `require.defined(value): asserts value is NonNullable<T>`
-   short-circuits the current flow on failure

This is inspired in part by Swift Testing’s split between expectation-style
and require-style checks.

When the docs talk about explicit aggregate or "run all" semantics, that
refers to low-level assertion composition such as `assertion.all(...)`, not
to builder-test control flow. In the builder API, the default control-flow
rule is simple: `assert` records and continues; `require` records and stops.

## Async Test Support

Tests may be synchronous or async. The framework should support awaited work
naturally without making `async` the default mental model for every test.
When a test does await work, `assert.*` and `require.*` may interleave with
those awaits in a straightforward way.

Each `assert.*` or `require.*` call records into the test's assertion log
immediately, regardless of whether more `await`s follow. The plan declared
at the top of the test body still applies; `case.assert.done()` at the end
finalizes the recorded log.

```ts
test('saves and re-reads', async (case) => {
    case.plan(3);

    const id = await store.save({ name: 'Ada' });
    case.assert.string(id);

    const fetched = await store.read(id);
    case.require.defined(fetched);
    case.assert.equal(fetched.name, 'Ada');

    return case.assert.done();
});
```

Key points:

-   `assert` between awaits is fine; the test body keeps running on success
-   `require` between awaits short-circuits on failure: subsequent awaits
    and assertions never run, the recorded log up to that point is reported
-   if an awaited operation rejects, that rejection is a runner error
    (see [Failure Artifacts](./failure-artifacts.md)), not an assertion failure; the test
    is recorded as such and the plan's expected count does not apply
-   the plan count covers only `assert.*` and `require.*` invocations;
    awaits do not count

## Throwing Mode

Throwing mode is still supported, but explicitly in the test API shape:

```ts
import { throwingTest as test } from '@overkill/test';

test('legacy flow', (case) => {
    case.assert.equal(add(2, 3), 5);
});
```

## Custom Assertions

`@overkill/assert` should support explicit extension with domain-specific
assertion vocabularies.

This is especially useful for ecosystems that repeatedly work with wrappers
such as `Result` or `Maybe`.

Example direction:

```ts
test('returns a successful result', (case) => {
    case.assert.resultOk(result);
    return case.assert.done();
});
```

These assertions should remain:

-   explicit
-   typed
-   registered through package wiring or JS/TS config

They should extend the first-party assertion system, not replace it with an
entirely separate assertion library.

This keeps large throwing-style suites ergonomic without introducing global
mode flags.

## Diff And Diagnostic Shape

Failed checks carry structured diff data. The sketched types
(`Diff`, `DiffOperation`, `Hunk`, `SerializedValue`, `SourceLocation`) are
collected in [Types Index § Outcomes And Verdicts](../reference/types-index.md#outcomes-and-verdicts).

```ts
type FailedCheck = {
    readonly id: string;
    readonly summary: string;
    readonly expected: unknown;
    readonly actual: unknown;
    readonly path: ReadonlyArray<string | number>;
    readonly location: SourceLocation;
    readonly diff?: Diff;
};

type Diff =
    | { kind: 'value'; expected: SerializedValue; actual: SerializedValue }
    | { kind: 'string'; expected: string; actual: string; hunks: ReadonlyArray<Hunk> }
    | { kind: 'object'; ops: ReadonlyArray<DiffOperation> }
    | { kind: 'array'; ops: ReadonlyArray<DiffOperation> }
    | { kind: 'binary'; expectedSize: number; actualSize: number; expectedHash: string; actualHash: string };
```

The `binary` kind covers cases where a meaningful structured diff is
not possible — compiled artifacts, encoded media, opaque blobs.
Reporters render it as a size-and-hash summary; the full bytes are
available out-of-band (the baseline files on disk, or attached run
artifacts) for external diff tools. Baseline subtypes that need
richer comparison (visual diff for screenshots, percentile diff for
performance) provide their own adapter-specific representations
above this type — see [Baselines And Snapshots](./baselines-and-snapshots.md).

Reporters render diffs from this structured shape. Truncation, colorization,
and ANSI rendering are reporter concerns; the data stays raw.

Default truncation: 100 lines per diff or 8 KiB per value, whichever is
hit first, with explicit truncation markers in the rendered output. Full
data preserved in the JSON event stream regardless of terminal truncation.

## Alternatives Worth Preserving

The architecture should preserve room for future exploration of:

-   assertions-as-effects: `AssertionNode` produced and accumulated on a
    per-test effect bus rather than returned (more amenable to highly-async
    test bodies)
-   richer relational checks: `relation()` for metamorphic testing (see
    [Ideas And Future Directions § Metamorphic Testing](../decisions/ideas-and-future-directions.md#metamorphic-testing))
-   semantic baseline comparisons via subtype-specific adapters (see
    [Baselines And Snapshots](./baselines-and-snapshots.md))

Vitest's domain snapshot adapter model is a useful sign that richer
comparison contracts are practical in real tooling.

### Assertions-As-Effects

One alternative worth preserving explicitly is an effect-oriented assertion
model:

-   instead of `case.assert.equal(...)` mutating a builder-owned log,
    assertion operations emit `AssertionNode`s into a per-test effect sink
-   the sink is owned by the runner, not by a hidden global registry
-   the test body can stay structurally close to ordinary imperative code,
    but the runner still receives a structured stream of assertion events

Sketch:

```ts
test('saves and re-reads', async (case) => {
    const id = await store.save({ name: 'Ada' });
    case.expect.string(id);

    const fetched = await store.read(id);
    case.require.defined(fetched);
    case.expect.equal(fetched.name, 'Ada');
});
```

Conceptually, `case.expect.equal(...)` would not finalize a result directly.
It would emit an assertion effect into the case-local sink, and the runner
would derive the final `TestOutcome` from the recorded effect stream after
the body finishes.

Why this is interesting:

-   it fits highly-async test bodies well because assertions can be recorded
    from any awaited segment without having to thread a returned
    `AssertionNode` through every helper boundary
-   it opens a path to richer live observation: reporters or debug tooling
    could observe assertion effects as they happen rather than only after
    `case.assert.done()`
-   it may compose better with helper abstractions that want to emit checks
    internally without forcing the caller to manually aggregate returned
    nodes

Why it is not the primary concept today:

-   the builder/result model is simpler to explain and already covers the
    common path
-   effect-style recording adds another layer of semantics around ordering,
    buffering, and finalization
-   once assertion emission becomes more stream-like, the line between
    ordinary assertions and runner instrumentation gets blurrier and needs
    tighter specification

Current stance: preserve this as a plausible future branch, but keep the
primary first-party authoring model centered on explicit builder APIs plus
`case.assert.done()`.

Source:

-   <https://vitest.dev/guide/snapshot.html>

## Settled Direction

For the product concept:

-   core supports structured assertion results and explicit throwing-mode
    tests
-   first-party assertions live in `@overkill/assert`, but ordinary tests
    primarily consume them through injected `case.assert` / `case.require`
-   primary authoring shape: builder/context API with explicit
    `return case.assert.done()`
-   low-level protocol name: `AssertionNode`
-   low-level constructor namespace: `assertion.*`
-   zero-assertion detection: failure, no opt-out
-   `plan(n)` is the assertion-count contract; no `atMost`, no `atLeast`,
    and `n > 0`
-   diff data is structured, not stack-mined
-   ordinary async/app errors remain distinct from assertion failures
-   `require` exists because narrowing and straight-line ergonomics matter
-   builder control flow is explicit: `assert` records and continues;
    `require` records and short-circuits
-   aggregate assertion composition should be explicit rather than the silent
    default

## Influences

-   AVA — zero-assertion detection as default failure
-   `node-tap` — `t.plan()` precedent
-   `elm-test` — returned-value expectations as inspiration for the protocol
    layer
-   ZIO Test — `Assertion` as a value
-   ScalaCheck — `Prop` as a value
-   Swift Testing — explicit split between non-gating and gating checks

## Sources

-   [AVA — Assertion planning](https://github.com/avajs/ava/blob/main/docs/03-assertions.md)
-   [node-tap — `t.plan()`](https://node-tap.org/api/plan)
-   [elm-test — `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
-   [Rust by Example — `Result` testing](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
-   [Vitest — domain snapshot adapters](https://vitest.dev/guide/snapshot.html)
