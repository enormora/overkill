# Assertions And Results

## The Problem

Overkill needs a result model that is:

-   simple enough for the core
-   rich enough for integrations
-   flexible enough for assertion tracking
-   structured enough that reporters and IDEs do not parse prose

## Baseline Outcome Contract

The core accepts at least two broad styles:

-   **returned structured outcome** — recommended; see
    `results-not-exceptions.md` for the full argument
-   **throw or reject** — supported via a thin adapter (`adapt.throwing`)
    so existing assertion libraries (`node:assert`, `chai`, `expect`)
    keep working

Both produce the same internal `TestOutcome` value. Reporters never see a
thrown failure on the success path; the runner converts thrown errors at
the adapter boundary.

This follows the broad lesson from Rust and similar systems that "failure
as exception" and "failure as returned result" can coexist, and from
`elm-test`, `tasty`, and ZIO Test that the returned-value shape scales
better.

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

It remains optional so the core stays open to other authoring styles.

## Zero-Assertion Detection As Default Failure

A test that runs to completion without performing any assertion is a
**failure** by default. AVA pioneered this convention in JS, and it is the
correct default: a test that asserts nothing is either incomplete, broken,
or a placeholder. Treating it as a pass quietly hides defects.

Default policy:

-   if a test body returns no `Check` (and uses no throwing assertions
    either), the runner reports it as `fail` with reason `no-assertions`
-   `plan(0, ...)` is the explicit opt-out for tests that intentionally
    assert nothing (extremely rare; usually the right answer is to delete
    the test)
-   tests that perform side-effect-only work and assert via the recorded
    effect log are *not* zero-assertion: the equality check on the
    recorded log is itself an assertion

Override surfaces:

-   per-test metadata `{ allowEmpty: true }` for the rare legitimate case
-   global config `assertions: { allowEmpty: 'warn' | 'fail' }` —
    default `fail` in CI, default `warn` in dev iteration

This is one of the smallest changes that materially raises the floor on
test quality, and it costs nothing to implement.

## `plan(n, ...)` Definition

`plan` declares the expected number of leaf checks in a test outcome. The
recommended shape returns a wrapped check:

```ts
test('parses three rows', ({ assert, plan }) => {
    const rows = parse(input);
    return plan(3, assert.all([
        assert.length(rows, 3),
        assert.equal(rows[0].id, 1),
        assert.equal(rows[1].id, 2),
    ]));
});
```

Semantics:

-   `plan(n, check)` requires the wrapped composite to contain exactly
    `n` leaf checks. Both more and fewer fail.
-   `plan.atLeast(n, check)` requires at least `n` (rare, useful for
    parameterized macros where the count is bounded below)
-   `plan.atMost(n, check)` requires at most `n` (rarely useful in
    practice; included for symmetry)

`plan` is not a global mutable counter. It is a decorator on a returned
check value. There is no `t.plan(n)` followed by separate assertions; the
plan and the checks are one composed value.

The corollary: a test that uses `plan(n, ...)` cannot accidentally hit
zero-assertion-fail because the plan itself is an assertion about the
check tree.

## Connection To `results-not-exceptions.md`

The recommended assertion shape is to *return* checks rather than throw.
`@overkill/assert` exposes:

-   value-vs-value comparisons returning `Check`: `assert.equal`,
    `assert.deepEqual`, `assert.length`, `assert.includes`,
    `assert.matches`, `assert.is`, `assert.ok`
-   composers: `assert.all([...])`, `assert.any([...])`, `assert.not(check)`
-   async: `assert.resolves(promise, value?)`, `assert.rejects(promise,
    expected?)`
-   throwing-adapter: `adapt.throwing(fn)` to wrap legacy code

A throwing assertion library remains usable; it just runs through the
adapter and produces the same `Check` shape.

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

-   assertions-as-effects: `Check` produced and accumulated on a per-test
    effect bus rather than returned (more amenable to highly-async test
    bodies)
-   richer relational checks: `relation()` for metamorphic testing (see
    `novel-techniques.md`)
-   semantic baseline comparisons via subtype-specific adapters (see
    `baselines-and-snapshots.md`)

Vitest's domain snapshot adapter model is a useful sign that richer
comparison contracts are practical in real tooling.

Source:

-   <https://vitest.dev/guide/snapshot.html>

## Current Concept Leaning

For the product concept:

-   core supports throw/reject and explicit result shapes
-   first-party assertions live in `@overkill/assert`
-   recommended authoring shape: returned `Check` values composed via
    `assert.all` / `assert.any`
-   zero-assertion detection: failure by default, with explicit overrides
-   `plan(n, check)` is the assertion-count contract; no global mutable
    counter
-   diff data is structured, not stack-mined
-   richer semantics layer on top of the core rather than being forced
    into every test

## Influences

-   AVA — zero-assertion detection as default failure
-   `node-tap` — `t.plan()` precedent (Overkill's `plan` differs in being
    a decorator on a returned value, not a side-effecting setter)
-   `elm-test` — the cleanest existing realisation of returned-value
    assertions
-   ZIO Test — `Assertion` as a value
-   ScalaCheck — `Prop` as a value

## Sources

-   [AVA — Assertion planning](https://github.com/avajs/ava/blob/main/docs/03-assertions.md)
-   [node-tap — `t.plan()`](https://node-tap.org/api/plan)
-   [elm-test — `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
-   [Rust by Example — `Result` testing](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
-   [Vitest — domain snapshot adapters](https://vitest.dev/guide/snapshot.html)
