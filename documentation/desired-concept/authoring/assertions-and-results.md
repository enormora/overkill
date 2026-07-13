# Assertions And Results

## The Problem

Overkill needs a result model that is:

- simple enough for the core
- rich enough for integrations
- flexible enough for assertion tracking
- structured enough that reporters and IDEs do not parse prose

## Baseline Outcome Contract

The core accepts two first-party styles:

- **builder/result mode** — the primary concept; tests receive injected
  `case.assert`, `case.require`, and `case.plan`, and must explicitly
  return `case.assert.done()`
- **throwing mode** — an explicit alternate test API such as
  `throwingTest`; tests may return `void`

Both produce the same internal `TestOutcome` value.

In builder/result mode, `case.assert.done()` should return a branded
`TestCompletion` value, not a public `TestOutcome`. A builder test that
returns any other concrete value is a test-author error. This keeps ordinary
application return values from being mistaken for meaningful test completion
signals.

The engine still normalizes the builder log into `TestOutcome` internally.
The brand is only a public API boundary: users complete builder tests through
the assertion context, while reporters and integrations consume structured
outcomes.

Sources:

- [Rust by Example — Unit testing with `Result`](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
- [elm-test — `Test` and `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Test)

## Why A First-Party Assertion Layer Still Makes Sense

Assertion tracking is hard to do well if assertions are entirely external.
A first-party assertion layer offers a clean place to provide:

- assertion count tracking
- `plan()`-style guarantees
- zero-assertion detection (see policy below)
- rich diffs and mismatch metadata
- baseline-aware serializers

Most tests should not need to import a separate assertion package at all.
The main user-facing API may come from direct engine consumers or from an
authoring layer such as `@overkill-dev/test`, but the underlying assertion layer
still lives directly in `@overkill-dev/engine`. The engine is the home for:

- assertion-count and plan tracking
- diffing and serializer logic
- internal assertion-protocol values used between authoring and engine
- implementation shared between default test facades and direct
  engine-level consumers

`@overkill-dev/assert` is still useful as a smaller companion package for
reusable assertion-extension helpers such as `defineCompositeAssertion(...)`
or foreign-assertion bridge builders. It should plug into the engine-owned
assertion context rather than replace it.

## API Constraints To Avoid Lint-Rule Patchwork

One useful design pressure is to avoid assertion APIs that routinely need
ESLint rules to compensate for ambiguity or weak defaults. The assertion
concept should therefore commit to these constraints:

- one strict assertion surface only; no loose/coercive equality variants
- no positional overloading where a later argument might mean matcher,
  options, or custom message depending on type
- if human annotation support is provided, it should be a prefix assertion
  context such as `case.assert.annotated('...').equal(actual, expected)`,
  not an extra positional message argument and not a postfix
  `.annotate(...)` on the result of an assertion call
- no public import-style split between several overlapping assertion entry
  points
- semantic first-class assertions should be preferred over generic boolean
  wrappers such as `ok(predicate())`
- rich built-ins should exist for deep equality, partial matching, regex
  matching, and call assertions so users do not need to encode intent via
  low-signal boolean checks
- async error assertions such as `throws` / `rejects` should avoid weak or
  ambiguous forms; matcher requirements should be expressed explicitly by
  signature or by separate APIs rather than by overloaded optional
  arguments
- custom assertions should follow the same rules: explicit names, no
  collisions, and no silent shadowing of built-ins

This does not eliminate every possible lint rule. A team may still want
policy rules, and generic equality-style APIs can still be misused by
reversing `actual` / `expected`. But the first-party assertion shape should
not depend on linting to resolve basic ambiguity.

## Zero-Assertion Detection As Default Failure

A test that runs to completion without performing any assertion is a
**failure** by default. AVA pioneered this convention in JS, and it is the
correct default: a test that asserts nothing is either incomplete, broken,
or a placeholder. Treating it as a pass quietly hides defects.

Default policy:

- if a test body records no assertion at all, the runner reports it as
  `fail` with reason `no-assertions`
- there is no `plan(0, ...)` escape hatch in the current concept; plans
  should describe a positive number of checks
- tests that perform side-effect-only work and assert via the recorded
  effect log are _not_ zero-assertion: the equality check on the
  recorded log is itself an assertion

There is no opt-out. A test that asserts nothing is broken; the
default policy is the only policy. This is one of the smallest changes
that materially raises the floor on test quality, and it costs nothing
to implement.

## `plan(n)` Definition

`plan` declares the expected number of assertion boundaries in a test:

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

- `plan(n)` must be the first call in the test body. Calling it after any
  `assert.*` or `require.*` invocation, or calling it more than once, is a
  test error
- `n` must be greater than `0`
- the test must record exactly `n` assertion boundaries before completion
- both more and fewer fail
- if the test never returns, timeout or crash handling applies instead

For ordinary assertions, one call records one boundary. Composite
assertions and property-family primitives such as `case.forall(...)` also
count as one boundary each.

This is explicit context injection, not hidden global mutable state.

## Built-In Assertion Catalog

The first-party built-in assertion surface should be intentionally small,
strict, and semantic.

Two namespaces exist:

- `case.assert.*` — broad assertion surface; records and continues
- `case.require.*` — narrow gating surface; records and short-circuits,
  primarily for type narrowing

### `case.require`

`require` should stay minimal. It exists to make preconditions explicit and
to support useful TypeScript narrowing in straight-line tests.

Recommended built-ins:

- `defined(value)`
- `null(value)`
- `notNull(value)`
- `string(value)`
- `number(value)`
- `boolean(value)`
- `function(value)`
- `object(value)`
- `array(value)`
- `instanceOf(value, ctor)`
- `hasProperty(value, key)`

`require` should not become a second full assertion DSL. Equality, regex,
numeric comparison, and doubles-specific assertions belong on `assert`, not
on `require`.

### `case.assert`

`assert` should include all useful `require` assertions plus the ordinary
test assertion vocabulary.

Recommended built-ins:

- equality
  - `equal(actual, expected)`
  - `notEqual(actual, expected)`
  - `deepEqual(actual, expected)`
  - `notDeepEqual(actual, expected)`
- partial / subset
  - `partialDeepEqual(actual, expectedSubset)`
  - `arrayContainsPartial(actual, expectedSubset)`
  - `membersPartialDeepEqual(actual, expectedMembers)`
- presence / boolean
  - `defined(value)`
  - `undefined(value)`
  - `null(value)`
  - `notNull(value)`
  - `true(value)`
  - `false(value)`
- type / shape
  - `string(value)`
  - `number(value)`
  - `boolean(value)`
  - `function(value)`
  - `object(value)`
  - `array(value)`
  - `instanceOf(value, ctor)`
  - `hasProperty(value, key)`
- numeric
  - `greaterThan(actual, threshold)`
  - `greaterThanOrEqual(actual, threshold)`
  - `lessThan(actual, threshold)`
  - `lessThanOrEqual(actual, threshold)`
  - `between(actual, min, max)`
- string / regex
  - `match(actual, pattern)`
  - `notMatch(actual, pattern)`
  - `includes(actual, part)`
  - `startsWith(actual, prefix)`
  - `endsWith(actual, suffix)`
- collection
  - `length(actual, expectedLength)`
  - `empty(value)`
  - `notEmpty(value)`
- async error checks
  - `throws(fn, matcher)`
  - `rejects(thunk, matcher)`
- control / metadata
  - `fail(reason?)`
  - `annotated(text).<assertion>(...)`
  - `done()`

The error assertions should stay strict:

- no weak `throwsAny` / `rejectsAny` built-ins
- no ambiguous positional matcher/message overloads
- `rejects` should prefer a thunk over an already-awaited promise value

The matcher itself should be a small object contract:

```ts
type ErrorMatcher = {
    readonly type?: abstract new (...args: ReadonlyArray<unknown>) => Error;
    readonly message?: string | RegExp;
    readonly code?: string;
    readonly name?: string;
    readonly cause?: ErrorMatcher;
};
```

Recommended examples:

```ts
case.assert.throws(doParse, {
    type: SyntaxError,
    message: /invalid header/,
});

await case.assert.rejects(
    () => loadUser('42'),
    {
        code: 'ENOENT',
        message: 'user not found',
    },
);
```

This matcher should stay intentionally small:

- no positional message argument
- no predicate overloads
- no arbitrary callback matcher DSL

If a test needs custom matching logic, it should catch the error and use
ordinary assertions on the resulting value instead of overloading the
`throws` / `rejects` surface.

`deepEqual` and `partialDeepEqual` should already understand modern
collection primitives such as `Map` and `Set`. Separate `mapEqual` /
`setEqual` built-ins are not needed in the first pass if the ordinary deep
assertions define sensible order-insensitive semantics for those types.

### Built-In Surface Boundaries

The built-in first-party surface should **not** center:

- loose equality variants
- generic truthiness helpers such as `ok(...)`
- weak "anything throws" forms
- giant call-assertion catalogs tied to one doubles package

If a concept is package-specific, it should extend the assertion surface
through a typed test facade rather than being forced into every default test
bundle.

## Property Tests And The Assertion Boundary

Property primitives like `case.forall(gen, body)` (proposed package
`@overkill-dev/property`) call `body` many times — once per generated
input — but count as **one assertion at the boundary** for both
zero-assertion detection and `plan(n)`:

- on success: `case.forall` records one assertion's worth of
  activity in the case's log; a property test that completes
  successfully therefore satisfies § Zero-Assertion Detection
  without forcing the author to write `case.plan(1)`
- on failure: `case.forall` records exactly one `FailedCheck` for
  the shrunk minimal counterexample, regardless of how many failing
  inputs were seen during shrinking
- `plan(n)` counts boundary assertions: a test with one
  `case.forall` call satisfies `case.plan(1)`; a test with two
  `case.forall` calls satisfies `case.plan(2)`

The body passed to `case.forall` should use an injected property-local
assertion context rather than importing a separate low-level assertion
package. A typical shape is:

```ts
test('round-trips', (case) => {
    return case.forall(gen.user(), (user, sample) => {
        sample.assert.equal(parse(serialize(user)), user);
        return sample.assert.done();
    });
});
```

The property helper owns the internal aggregation and decides what to record
at the boundary. User code stays on the same injected-assertion model as
ordinary tests. See
[Tests As Values § Macros And Parameterized Tests](./tests-as-values.md#macros-and-parameterized-tests) for the
canonical authoring shape, and [Failure Walkthrough](./failure-walkthrough.md) for an
end-to-end walked example.

The same boundary rule should apply to other property-family primitives such
as metamorphic relations and differential checks: each counts as one
boundary assertion regardless of internal iteration.

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

- the success path still depends on exception-oriented machinery
- stack walking becomes part of ordinary failure rendering
- machine-readable integrations must reconstruct meaning from error
  objects and strings
- "test failed" and "runner could not execute the test correctly" are
  easy to muddle together

Overkill's structured outcome model avoids that at the architectural
level. Reporters, IDEs, MCP servers, and remote executors consume
structured data instead of parsing prose.

### The Protocol Shape

The engine treats structured outcomes as canonical:

```ts
// engine-level outcome; reporter-facing verdicts (for example
// `crashed`) are derived from outcome + metadata + runner-error state
// — see Glossary § Test Outcome / Test Verdict.
type TestOutcome = Pass | Fail | Skip | Inconclusive;

type Pass = { kind: 'pass'; };

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

The builder APIs normalize recorded checks into the same structured
outcomes. Internally Overkill may still use assertion-protocol values while
assembling those outcomes, but that protocol no longer needs to be a
separate public authoring package.

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

- `assert.*` records ordinary assertions
- `require.*` records gating assertions and short-circuits on failure;
  `require` exists because TypeScript narrowing matters in
  straight-line tests

Builder mode does not invalidate the underlying result-oriented
protocol — it is simply a friendlier way to produce it. `throwingTest`
remains a supported alternate authoring style, but the engine
normalizes its result into the same structured `TestOutcome` shape so
reporters consume one failure model.

### Internal Protocol Versus Public API

Overkill still benefits from an internal assertion protocol while moving
checks between authoring helpers and the engine, but that protocol does not
need to be exposed as a separate first-party user package.

The public concept therefore stays simpler:

- day-to-day tests use injected `case.assert` / `case.require`
- property helpers such as `case.forall(...)` use a nested injected
  assertion context
- the engine still receives structured `FailedCheck` data, diffs, and
  counts without users constructing protocol nodes directly

### Error Separation

The protocol model sharpens an important distinction:

- **assertion failure** — structured test outcome
- **runner error** — unexpected exception, rejection, crash, permission
  denial, or runtime failure

This separation is part of the core concept. Assertion failures should
not need to travel through the same path as infrastructure errors. See
[Failure Artifacts](./failure-artifacts.md) and
[Runtime Behavior](../architecture/runtime-behavior.md).

### Engine Flexibility

The narrow `@overkill-dev/engine` stays flexible enough to support:

- builder/context authoring
- explicit throwing mode
- value-oriented suite trees and test nodes
- higher-layer or extension packages that need compositional result values

That is why the engine continues to speak structured outcomes natively,
even though the default human-facing authoring experience is no longer
pure returned-value assertions.

### Influences

- `elm-test` — expectations as values
- ZIO Test — assertions as values
- ScalaCheck — properties as values
- Rust — coexistence of alternate test-result styles

Sources:

- [elm-test — `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
- [ZIO Test — Why ZIO Test](https://zio.dev/reference/test/why-zio-test/)
- [ScalaCheck — Properties](https://scalacheck.org/documentation.html)
- [Rust by Example — Unit testing with `Result`](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)

## `assert` Versus `require`

This split should be explicit in the documentation.

`assert`:

- records an assertion
- returns `void` in the builder API
- does not short-circuit the test body on failure
- is suitable for the ordinary “check and continue” path

`require`:

- records a gating assertion
- supports narrowing-style APIs such as
  `require.defined(value): asserts value is NonNullable<T>`
- short-circuits the current flow on failure

This is inspired in part by Swift Testing’s split between expectation-style
and require-style checks.

When the documentation talks about explicit aggregate or "run all" semantics, that
refers to explicit aggregate helpers in the assertion layer, not to
builder-test control flow. In the builder API, the default control-flow
rule is simple: `case.assert` records and continues; `case.require`
records and stops.

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

- `assert` between awaits is fine; the test body keeps running on success
- `require` between awaits short-circuits on failure: subsequent awaits
  and assertions never run, the recorded log up to that point is reported
- if an awaited operation rejects, that rejection is a runner error
  (see [Failure Artifacts](./failure-artifacts.md)), not an assertion failure; the test
  is recorded as such and the plan's expected count does not apply
- the plan count covers only `assert.*` and `require.*` invocations;
  awaits do not count

## Throwing Mode

Throwing mode is still supported, but explicitly in the test API shape:

```ts
import { throwingTest as test } from '@overkill-dev/test';

test('legacy flow', (case) => {
    case.assert.equal(add(2, 3), 5);
});
```

## Custom Assertions

The assertion layer should support explicit extension with domain-specific
assertion vocabularies exposed through the high-level test API.

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

- explicit
- typed
- registered through package wiring or JS/TS configuration
- uniquely named across both first-party and registered custom assertions

They should extend the first-party assertion system, not replace it with an
entirely separate assertion library.

This keeps large throwing-style suites ergonomic without introducing global
mode flags.

Registration must reject collisions. A custom assertion may not shadow:

- a built-in first-party assertion
- another registered custom assertion

Such collisions should fail during assertion-context construction or suite startup rather
than silently overriding anything.

### Assertion Extensions And Engine Context

Custom assertions should no longer be registered in root runner configuration.
Instead, they belong to the **engine-owned assertion context**, because
assertion registration changes what `case.assert` exposes even when a
project is not using `@overkill-dev/test`.

Recommended shape:

```ts
import { defineCompositeAssertion } from '@overkill-dev/assert';
import type { TestDouble } from '@overkill-dev/doubles';

const calledOnceWith = defineCompositeAssertion(
    'calledOnceWith',
    <TArg>(check, sut: TestDouble<[TArg], unknown>, expected: TArg) => {
        return check.group([ check.calledOnce(sut), check.calledWith(sut, expected) ]);
    }
);
```

Authoring layers such as `@overkill-dev/test` may re-expose the resulting
engine-backed assertion context, but they do not own assertion registration.

### Composite Assertions

A particularly useful subtype of custom assertion is the **composite
assertion**: one named assertion built from several existing checks.

This is distinct from a test macro:

- a test macro builds `TestNode`s
- a composite assertion stays inside one existing test body and names one
  reusable invariant

Definition shape:

```ts
import { defineCompositeAssertion } from '@overkill-dev/assert';
import type { TestDouble } from '@overkill-dev/doubles';

const calledOnceWith = defineCompositeAssertion(
    'calledOnceWith',
    <TArg>(check, sut: TestDouble<[TArg], unknown>, expected: TArg) => {
        return check.group([ check.calledOnce(sut), check.calledWith(sut, expected) ]);
    }
);
```

Registered composite assertions then appear as ordinary high-level
assertions:

```ts
test('publishes the release', async (case) => {
    await publishRelease(harness, 'v1.2.3');

    case.assert.calledOnceWith(harness.buildAndPublishAll, {
        tag: 'v1.2.3',
    });

    return case.assert.done();
});
```

Important rule:

- a composite assertion counts as **one** assertion boundary for
  zero-assertion detection and `plan(n)`
- the child checks inside `check.group([...])` are grouped diagnostics, not
  extra plan units

This keeps `plan(n)` stable and prevents assertion-counting from depending
on how a custom assertion happens to be implemented internally.

### Foreign Assertion Bridges

Overkill should **not** try to absorb arbitrary third-party assertion
libraries into `case.assert.*` wholesale.

That would make too many core behaviors ambiguous:

- assertion counting
- `plan(n)` semantics
- failure normalization
- annotations
- location metadata
- `require`-style narrowing

The better direction is one narrow bridge primitive for adapter authors:

```ts
type ForeignAssertionBridge = {
    fromThrowable(label: string, body: () => void | Promise<void>): unknown;
};
```

That bridge converts a foreign throwable-style assertion callback into one
Overkill assertion boundary:

- success records one passed assertion boundary
- failure records one `FailedCheck`
- thrown foreign errors are normalized into Overkill's structured
  diagnostics

The callback may internally run a complex foreign assertion library, but the
Overkill boundary remains explicit and stable.

Example direction:

```ts
import { defineCompositeAssertion } from '@overkill-dev/assert';

export const hasResourceProperties = defineCompositeAssertion(
    'hasResourceProperties',
    (check, stack, resourceType, expected) => {
        return check.fromThrowable('aws-cdk.assertions.hasResourceProperties', () => {
            const template = Template.fromStack(stack);
            template.hasResourceProperties(resourceType, expected);
        });
    }
);
```

This still counts as **one** assertion boundary for zero-assertion
detection, `plan(n)`, and assertion budgets.

The rule should therefore be:

- no generic third-party assertion plug-in surface
- yes to package-specific adapters built on one normalized foreign
  assertion bridge

### Package-Specific Assertion Adapters

Some ecosystems already have strong domain-specific assertion libraries that
are not worth rewriting. `@aws-cdk/assertions` is a good example.

The preferred Overkill direction is a focused adapter package such as:

- `@overkill-dev/aws-cdk`

That package should expose facade-ready assertion extensions such as:

- `matchesTemplate`
- `hasResource`
- `hasResourceProperties`
- `resourceCountIs`
- `hasOutput`

Usage direction:

```ts
import { cdkAssertions } from '@overkill-dev/aws-cdk';

export const assertionExtensions = [ cdkAssertions ];
```

Then ordinary tests use a native Overkill surface:

```ts
test('defines versioned bucket', (case) => {
    case.assert.hasResourceProperties(stack, 'AWS::S3::Bucket', {
        VersioningConfiguration: { Status: 'Enabled' },
    });

    return case.assert.done();
});
```

Internally the adapter still uses the official CDK assertion library, but
Overkill remains the owner of counting, failure boundaries, and reporting.

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
    | { kind: 'value'; expected: SerializedValue; actual: SerializedValue; }
    | { kind: 'string'; expected: string; actual: string; hunks: ReadonlyArray<Hunk>; }
    | { kind: 'object'; ops: ReadonlyArray<DiffOperation>; }
    | { kind: 'array'; ops: ReadonlyArray<DiffOperation>; }
    | { kind: 'binary'; expectedSize: number; actualSize: number; expectedHash: string; actualHash: string; };
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

## Settled Direction

For the product concept:

- core supports structured assertion results and explicit throwing-mode
  tests
- first-party assertion semantics live in `@overkill-dev/engine`
- reusable assertion-extension helpers such as
  `defineCompositeAssertion(...)` live in `@overkill-dev/assert`
- `@overkill-dev/test` may re-expose that engine-owned assertion surface, but it
  is not required for assertion usage
- primary authoring shape: builder/context API with explicit
  `return case.assert.done()`
- `AssertionNode` may still exist as an internal protocol term, but not as
  a separate public-first authoring surface
- zero-assertion detection: failure, no opt-out
- `plan(n)` is the assertion-count contract; no `atMost`, no `atLeast`,
  and `n > 0`
- optional global assertion budgets are allowed as a centrally configured
  policy; they count assertion boundaries, so composite assertions and
  `case.forall(...)` each count as 1
- diff data is structured, not stack-mined
- ordinary async/app errors remain distinct from assertion failures
- `require` exists because narrowing and straight-line ergonomics matter
- builder control flow is explicit: `assert` records and continues;
  `require` records and short-circuits
- aggregate assertion composition should be explicit rather than the silent
  default

## Assertion Influences

- AVA — zero-assertion detection as default failure
- `node-tap` — `t.plan()` precedent
- `elm-test` — returned-value expectations as inspiration for the protocol
  layer
- ZIO Test — `Assertion` as a value
- ScalaCheck — `Prop` as a value
- Swift Testing — explicit split between non-gating and gating checks

## Sources

- [AVA — Assertion planning](https://github.com/avajs/ava/blob/main/docs/03-assertions.md)
- [node-tap — `t.plan()`](https://node-tap.org/api/plan)
- [elm-test — `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Expect)
- [Rust by Example — `Result` testing](https://doc.rust-lang.org/rust-by-example/testing/unit_testing.html)
- [Vitest — domain snapshot adapters](https://vitest.dev/guide/snapshot.html)
