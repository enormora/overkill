# Results, Not Exceptions

## Why This Doc Exists

Almost every JavaScript test runner in 2026 treats a failing assertion as a thrown
exception. Jest, Vitest, Mocha, AVA, Bun, `node:test` all share the same shape:

-   `expect(...)` throws `JestAssertionError` (or equivalent) on mismatch
-   the runner wraps the test body in `try/catch`
-   the caught error is formatted, possibly re-thrown, possibly attached to a
    result object
-   the stack trace is mined for the original `expect` call site

This is so universal that most people stop noticing it is a *choice*. It is not
the only choice, and it is not the best choice for Overkill's stated values:
determinism, no magic, explicit over implicit, fast feedback, machine-readable
results.

This document argues that the canonical Overkill outcome model should be a
**returned result value**, not a thrown exception, and sketches what that looks
like end-to-end.

## The Problem With Throwing

Throwing-based assertions are popular because they are convenient: they exit
the test body at the first mismatch and they piggy-back on the stack trace for
location data. The convenience hides several real costs.

### Control-flow surprise

The test body looks like ordinary code, but any single `expect` can abort the
function. Refactoring is fragile: an `await` rearrangement, a wrapping
`try/catch`, a Promise chain tail can quietly swallow the failure. Async
iteration, parallel `Promise.all`, and `using` resource teardown all interact
badly with mid-function throws.

### Catching is mandatory machinery

The runner needs a `try { await body() } catch (e) { record(e) }` wrapper at
some level. That wrapper has to make decisions: which errors are assertion
failures, which are runner bugs, which are programmer mistakes? The Jest
codebase has hundreds of lines dedicated to this disambiguation. It is one of
the largest sources of "magic" in mainstream runners — exactly what Overkill's
principles forbid.

### Stack walking and source maps

To turn a thrown error into a useful diff, the runner reads the stack, drops
its own frames, locates the user's `expect` call, opens the source map,
re-reads the source, and reconstructs context. Every one of those steps is a
source of slowness, fragility, and platform-specific heuristics.

### Hostile interaction with structured concurrency

When tests run inside `AbortController` cancellation, `using` disposers, and
async iteration, exceptions become entangled with cancellation paths. Distinguishing
"the test failed" from "the test was cancelled" from "a teardown threw" turns
into ad-hoc reasoning.

### Multiple failures lost

A throw exits at the first failure. Tests that want to record several
mismatches in one body — which is exactly the right shape for property tests,
table-driven tests, and approval tests — are forced into a loop-and-collect
pattern that the runner does not natively understand.

### Hard to make machine-readable

Thrown errors are objects with prose `.message` strings. Reporters and IDE
plugins then re-parse those strings. A returned value can carry typed,
schema-stable data without any string parsing.

## The Alternative: Tests Return A Result

The Overkill direction:

-   a test body returns (or resolves to) a `TestOutcome` value
-   assertions return `Check` values that compose into the outcome
-   the runner does not need a `try/catch` for assertion failures (it still
    catches programmer bugs, see below)
-   reporters and integrations consume the structured outcome directly

The shape can be as small as:

```ts
type Pass = { kind: 'pass' };
type Fail = { kind: 'fail'; checks: ReadonlyArray<FailedCheck> };
type Skip = { kind: 'skip'; reason: string };
type Inconclusive = { kind: 'inconclusive'; reason: string };

type TestOutcome = Pass | Fail | Skip | Inconclusive;

type FailedCheck = {
    readonly id: string;
    readonly summary: string;
    readonly expected: unknown;
    readonly actual: unknown;
    readonly path: ReadonlyArray<string | number>;
    readonly location: SourceLocation;
};
```

A simple test then reads:

```ts
import { test, check } from '@overkill/test';

test('add', ({ assert }) => {
    return assert.equal(add(2, 3), 5);
});
```

`assert.equal` does *not* throw. It returns a `Check` whose `kind` is `'pass'`
or `'fail'`. The test returns the check. The runner reads the result.

Multiple checks compose:

```ts
test('user shape', ({ assert }) => {
    const u = build();
    return assert.all([
        assert.equal(u.id, '42'),
        assert.equal(u.name, 'Ada'),
        assert.length(u.roles, 2),
    ]);
});
```

`assert.all` reports every failed check, not just the first.

For property and table-driven tests, the natural shape is a fold:

```ts
test('round-trip', ({ forall, assert }) => {
    return forall(arbitrary.user, (u) => assert.equal(parse(serialize(u)), u));
});
```

`forall` returns a `Check` that includes the full counterexample trail when it
fails — no string parsing, no re-throw.

## The Async Case

Tests are async. A returned `Promise<TestOutcome>` is the natural shape:

```ts
test('reads file', async ({ assert, world }) => {
    const content = await world.fs.read('fixture.txt');
    return assert.equal(content, 'expected');
});
```

The runner awaits the returned value. There is no `try/catch` around the
assertion. If `world.fs.read` rejects, that rejection *is* a programmer error
or test-environment error — different from an assertion failure. Overkill
handles it via the rejection path described in the next section.

## What About Real Errors?

Test code still has bugs. A typo can throw `TypeError`. A missing fixture can
reject. Overkill does not pretend these don't happen. The model:

-   **Assertion failure** — `kind: 'fail'`, returned by the test body. No
    exception.
-   **Runner error** — caught by the runner around the test body, attributed
    explicitly. The reporter shows it as "the runner could not observe this
    test" rather than "the test failed".

The two categories are reported separately, which solves a long-standing
muddle in JS runners (see `failure-artifacts.md`'s "Test Failures Versus
Errors").

The runner still wraps the body in `try/catch`. The difference is that the
catch path is no longer the *normal* failure flow; it is reserved for
unexpected exceptions. That gives the catch handler a single, narrow job:
classify and report runner-level errors.

## Throwing Adapters Are Allowed

Overkill should not refuse to support throwing assertions. Many users will
import `node:assert` or a third-party assertion library. The runner can wrap
any callback with a thin adapter:

```ts
test('legacy', adapt.throwing((t) => {
    nodeAssert.equal(add(2, 3), 5);
}));
```

`adapt.throwing` runs the body, catches any `AssertionError` it knows about,
turns it into a `Fail`, and returns the result. The runner core never sees a
thrown failure; the adapter is the conversion point.

This preserves compatibility for users who want to migrate from existing
runners, without polluting the canonical model.

## Composition Over Combination Helpers

Because every check is a value, composition is structural:

```ts
function isValidUser(u: User, { assert }: Context) {
    return assert.all([
        assert.string(u.id),
        assert.string(u.name),
        assert.array(u.roles),
    ]);
}

test('fetch returns valid user', async ({ assert, ...c }) => {
    const u = await fetchUser('42');
    return isValidUser(u, c);
});
```

Reusable checks become reusable functions returning `Check`. There is no
"helper that internally throws", no shared mutable assertion counter, no
hidden ordering. Reuse looks like ordinary value composition.

## Plan Without Globals

`plan(n)` becomes a check decorator rather than a side-effecting setter:

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

`plan(3, check)` requires the wrapped composite check to contain exactly three
leaf checks. No mutable counter, no global state, no after-the-fact
verification.

## Skip, Inconclusive, And Expected Failure As First-Class Verdicts

Returning a value lets Overkill expose richer verdicts without parsing prose:

```ts
test('only on linux', ({ skip, assert, world }) => {
    if (world.platform !== 'linux') return skip('not on linux');
    return assert.equal(world.uname(), 'Linux');
});

test('flaky waiting on #4711', ({ assert, expectFail }) => {
    return expectFail(assert.equal(call(), expected), 'pending fix in #4711');
});

test('depends on docker', ({ inconclusive, world }) => {
    if (!world.docker.available) return inconclusive('docker not available');
    // ...
});
```

`pass`, `fail`, `skip`, `expected-fail` (xfail), `unexpected-pass` (xpass), and
`inconclusive` are all members of the same algebraic verdict type. Reporters,
CI gates, and IDE views all see structured kinds rather than guessing from
strings.

This connects directly to the "out-of-band test verdicts" gap identified in
the audit and is one of the cheapest wins from the broader returned-value
model.

## Effects Are Logged, Not Mocked

Returned-value tests pair naturally with the capability-handle pattern:

```ts
test('saves user', async ({ assert, world }) => {
    const result = await saveUser(world, { id: '42', name: 'Ada' });
    return assert.all([
        assert.ok(result.ok),
        assert.equal(world.recorded(), [
            { kind: 'http.post', url: '/users', body: { id: '42', name: 'Ada' } },
            { kind: 'log.info', msg: 'saved 42' },
        ]),
    ]);
});
```

`world` is a typed bag of capability handles (`http`, `log`, `clock`,
`random`, `fs`). Test variants of those handles record their calls. The test
asserts on the recorded effect log, not on patched globals. The whole system
is a function from `(input, world)` to `(output, effects, outcome)` —
deterministic, replayable, no monkey patching anywhere.

This is the kernel idea exported from Haskell `IO` separation, ZIO Test
environments, and Elm's `Cmd` model. It only works cleanly when assertions
themselves are returned values.

## Why The Engine Should Speak This Natively

The narrow `@overkill/engine` already promises to support both throw-style and
return-style outcomes (open question 1.2). The recommendation here is
stronger: the engine's *internal* representation of a test result should be
the structured `TestOutcome`, and `adapt.throwing` should be a layer on top.

Practical consequences:

-   reporters never need to read `Error.stack` to format a diff
-   the JSON event stream payload is the same shape as the in-memory result
-   IDEs and MCP servers consume one schema, not two
-   the V8 startup snapshot (see `fast-feedback-loops.md`) does not need
    `Error` machinery loaded for the success path
-   stack walking only happens on real exceptions, which are rare in well-
    written tests

This concretely speeds up the success path. A test that passes never
constructs an `Error`, never walks a stack, never parses a source map.

## Multiple Failed Checks Per Test

Returning a tree of checks means the runner can report several failures from
one test without rerunning the body:

```
✗ user shape
  ✗ id should equal "42" but was "43"
    at user.test.ts:14
  ✗ length of roles should be 2 but was 1
    at user.test.ts:16
```

In a thrown model, the second failure is invisible until the first is fixed.
This is exactly the behavior that makes large suites painful to migrate.

## Where Throwing Still Makes Sense

The runner does not pretend exceptions don't exist. The following stay
exception-shaped:

-   programmer errors (`TypeError`, `ReferenceError`)
-   capability violations (Node permission denials)
-   resource construction failures (fixture setup throwing)
-   `AbortError` on cancellation
-   subprocess crash signals

These are all *runner errors*, classified separately from the test verdict.
Overkill catches them, attributes them to the most specific identity it can
(test, file, run), and surfaces them as runner-level diagnostics with their
own reporter rendering.

## Comparison To Prior Art

-   **Elm `elm-test`**: tests are values of a `Test` ADT and return `Expect`
    values; no throws involved. The closest existing model in any popular
    ecosystem.
-   **Haskell `tasty`**: a test is a `TestTree` value; results are typed
    outcomes; ingredients (reporters) consume the tree.
-   **Rust `#[test]` with `Result`**: the `Result<(), E>` test signature is
    the supported alternative to panic-based tests. Rust shows that both
    coexisting in one runner is realistic.
-   **ZIO Test**: tests return `Spec[R, E]`; the runner walks the value.
-   **ScalaCheck `Prop`**: properties are values, not assertions.

Across all of these, the same observation holds: returning a value scales
better than throwing, especially as the testing surface grows beyond simple
example tests.

## Migration Story

The transition from a throwing baseline is gentle:

1.  Ship the structured outcome as the canonical engine type.
2.  Ship `adapt.throwing` so existing test bodies keep working.
3.  Ship `assert.*` returning `Check` values as the recommended new style.
4.  Document the throwing path as legacy compatibility, not the recommended
    style.
5.  Reporters consume the structured outcome regardless of which path the
    test author took.

No user is forced to rewrite their tests. The internal shape is uniform.

## Relationship To Other Docs

-   `assertions-and-results.md` — this doc replaces the loose "alternatives
    worth preserving" bullet with a concrete recommendation. The two should
    be read together.
-   `failure-artifacts.md` — the runner-error vs test-failure distinction is
    crisp here: assertion failures never travel through the catch path.
-   `microtests-and-capabilities.md` — pairs naturally with capability
    handles and the recording-handle pattern.
-   `package-architecture.md` — `@overkill/engine` should expose
    `TestOutcome` as a stable type; `@overkill/assert` should produce
    `Check` values; `@overkill/test` should make returning the outcome the
    default.
-   `fast-feedback-loops.md` — the success path does not allocate `Error`
    objects, does not walk stacks, does not lazy-load `pretty-format` until a
    real failure happens.

## Influences

-   `elm-test`'s `Test` and `Expect` types
-   Haskell `tasty`'s tree-of-tests model
-   Rust's `Result<(), E>` test signature
-   ZIO Test's value-based assertions
-   ScalaCheck's `Prop`
-   Elm Architecture's effect descriptions vs runtime executors

## Sources

-   [elm-test — `Expect` documentation](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
-   [Haskell `tasty` README](https://github.com/UnkindPartition/tasty)
-   [Rust by Example — Unit testing with `Result`](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
-   [ZIO Test — Why ZIO Test](https://zio.dev/reference/test/why-zio-test/)
-   [ScalaCheck — Properties](https://scalacheck.org/documentation.html)
