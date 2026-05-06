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
    `assert`, `require`, and `plan`, and must explicitly return
    `assert.done()`
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

## Connection To `results-not-exceptions.md`

The low-level protocol remains `AssertionNode`, but the primary authoring DX
is the injected builder API:

```ts
test('user shape', (case) => {
    case.require.defined(user);
    case.assert.equal(user.name, 'Ada');
    return case.assert.done();
});
```

Key distinction:

-   `assert.*` records ordinary assertions
-   `require.*` records gating assertions and short-circuits on failure

`require` exists because TypeScript narrowing matters. A test framework that
never allows gating assertions cannot support ergonomic narrowing in
straight-line TypeScript tests.

The low-level `@overkill/assert` package can still expose:

-   `assertion.equal(...) -> AssertionNode`
-   `assertion.all(...) -> AssertionNode`
-   other low-level node constructors for advanced composition

But that is not the primary end-user style.

## `assert` Versus `require`

This split should be explicit in the docs.

`assert`:

-   records an assertion
-   returns `void` in the builder API
-   is suitable for the ordinary “check and continue” path

`require`:

-   records a gating assertion
-   supports narrowing-style APIs such as
    `require.defined(value): asserts value is NonNullable<T>`
-   short-circuits the current flow on failure

This is inspired in part by Swift Testing’s split between expectation-style
and require-style checks.

## Async Tests

Tests are async by default and may interleave assertions with awaited work.
Each `assert.*` or `require.*` call records into the test's assertion log
immediately, regardless of whether more `await`s follow. The plan declared
at the top of the test body still applies; `assert.done()` at the end
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
    (see `failure-artifacts.md`), not an assertion failure; the test
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

Failed checks carry structured diff data:

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
    | { kind: 'object'; ops: ReadonlyArray<DiffOp> }
    | { kind: 'array'; ops: ReadonlyArray<DiffOp> };
```

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
    `novel-techniques.md`)
-   semantic baseline comparisons via subtype-specific adapters (see
    `baselines-and-snapshots.md`)

Vitest's domain snapshot adapter model is a useful sign that richer
comparison contracts are practical in real tooling.

Source:

-   <https://vitest.dev/guide/snapshot.html>

## Settled Direction

For the product concept:

-   core supports structured assertion results and explicit throwing-mode
    tests
-   first-party assertions live in `@overkill/assert`, but ordinary tests
    primarily consume them through injected `assert` / `require`
-   primary authoring shape: builder/context API with explicit
    `return assert.done()`
-   low-level protocol name: `AssertionNode`
-   low-level constructor namespace: `assertion.*`
-   zero-assertion detection: failure by default, with explicit overrides
-   `plan(n)` is the assertion-count contract; no `atMost`, no `atLeast`,
    and `n > 0`
-   diff data is structured, not stack-mined
-   ordinary async/app errors remain distinct from assertion failures
-   `require` exists because narrowing and straight-line ergonomics matter
-   aggregate “run all” semantics should be explicit rather than the silent
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
