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

In builder/result mode, `case.assert.done()` returns the non-empty assertion
node list recorded by the injected assertion context, not a public
`TestOutcome`. A builder test may also return one assertion node directly for
the small direct-engine path. Returning ordinary application values is outside
the supported builder contract.

Direct engine consumers may return public low-level assert-source
`AssertionNode` values. Normal builder completion still needs at least one
returned assert-source node, even if successful `case.require.*` calls were
recorded. Successful `require` entries count toward `plan(n)` only after a
valid assert-source result exists.

The engine normalizes these lazy assertion nodes into `TestOutcome`
internally. Users complete builder tests through the assertion context, while
reporters and integrations consume structured outcomes.

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
- public low-level assertion-protocol values used between authoring and engine
- implementation shared between default test facades and direct
  engine-level consumers

`@overkill-dev/engine` owns the v1 assertion reference helpers.
`@overkill-dev/assert` may later become a smaller companion package that
hosts or re-exports helpers such as `defineCompositeAssertion(...)` and
foreign-assertion bridge builders.

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

`case.assert.done()` is not an assertion protocol primitive. It belongs to
builder/result mode only: it completes the injected case builder and returns
the non-empty assert-source assertion list to the engine. A future reusable
`@overkill-dev/assert` API should be able to reuse assertion semantics without
carrying builder completion.

`annotated(text)` creates a scoped assertion facade that applies `text` as the
human-facing failure summary for the next assertion calls made through that
facade:

```ts
case.assert.annotated('cart starts empty').empty(cart.items);
case.require.annotated('user id must be present').string(input.userId);
```

The low-level assertion node still carries a nullable `message` field. That is
protocol data, not a reason to add positional message overloads.

### Current Built-In Assertion Reference

Each signature below is available on `case.assert` unless noted otherwise.
`case.require` intentionally exposes only the narrow gating subset listed in
the `case.require` section.

#### `annotated(text)`

Signature: `annotated(text: string)`

```ts
case.assert.annotated('response includes account id').string(response.accountId);
```

Returns a scoped assertion facade that records `text` as the failure message
for assertions made through it. It is a prefix context, so the assertion
signature stays focused on assertion operands.

#### `array(actual)`

Signature: `array(actual: unknown)`

```ts
case.assert.array(rows);
```

Passes only when `actual` is an array. Also available on `case.require` for
type narrowing.

#### `arrayContainsPartial(actual, expectedSubset)`

Signature: `arrayContainsPartial<Actual, Expected>(actual: readonly DeepComparable<Actual>[], expectedSubset: DeepComparable<Expected>)`

```ts
case.assert.arrayContainsPartial(users, { id: 'u1', role: 'admin' });
```

Passes when at least one array item partially deep-matches `expectedSubset`.
Extra properties on the matching item are allowed, so this is for finding a
record by important fields rather than checking the whole collection.

#### `between(actual, minimum, maximum)`

Signature: `between(actual: number, minimum: number, maximum: number)`

```ts
case.assert.between(score, 0, 100);
```

Passes when `actual` is greater than or equal to `minimum` and less than or
equal to `maximum`.

#### `boolean(actual)`

Signature: `boolean(actual: unknown)`

```ts
case.assert.boolean(flag);
```

Passes only when `actual` is a boolean. Also available on `case.require` for
type narrowing.

#### `deepEqual(actual, expected)`

Signature: `deepEqual<Actual, Expected>(actual: DeepComparable<Actual>, expected: DeepComparable<Expected>)`

```ts
case.assert.deepEqual(result, { ok: true, count: 2 });
```

Passes when `actual` and `expected` are deeply equal with strict semantics.
This is the default full-structure equality assertion.
Top-level operands must be non-primitive or `unknown`.

#### `defined(actual)`

Signature: `defined(actual: unknown)`

```ts
case.assert.defined(config.port);
```

Passes when `actual` is neither `null` nor `undefined`. Also available on
`case.require` for type narrowing.

#### `empty(actual)`

Signature: `empty(actual: unknown)`

```ts
case.assert.empty(queue);
```

Passes when the value has a supported collection count of `0`. Supported
values include strings, arrays, maps, sets, plain objects, and iterables.

#### `endsWith(actual, expected)`

Signature: `endsWith(actual: string, expected: string)`

```ts
case.assert.endsWith(filename, '.json');
```

Passes when `actual` ends with `expected`.

#### `equal(actual, expected)`

Signature: `equal(actual: unknown, expected: unknown)`

```ts
case.assert.equal(statusCode, 200);
```

Passes when `Object.is(actual, expected)` passes. Use it for scalar or
identity equality, not for deep object comparison.

#### `fail()`

Signature: `fail()`

```ts
case.assert.annotated('unreachable branch executed').fail();
```

Always records a failed assertion. It is useful for impossible branches after
the test has enough context to explain why reaching them is wrong.

#### `false(actual)`

Signature: `false(actual: unknown)`

```ts
case.assert.false(result.cached);
```

Passes only when `actual` is exactly `false`.

#### `function(actual)`

Signature: `function(actual: unknown)`

```ts
case.assert.function(plugin.load);
```

Passes only when `actual` is a function. Also available on `case.require` for
type narrowing.

#### `greaterThan(actual, expected)`

Signature: `greaterThan(actual: number, expected: number)`

```ts
case.assert.greaterThan(durationMs, 0);
```

Passes when `actual` is strictly greater than `expected`.

#### `greaterThanOrEqual(actual, expected)`

Signature: `greaterThanOrEqual(actual: number, expected: number)`

```ts
case.assert.greaterThanOrEqual(retryCount, 1);
```

Passes when `actual` is greater than or equal to `expected`.

#### `hasProperty(actual, key)`

Signature: `hasProperty(actual: unknown, key: PropertyKey)`

```ts
case.assert.hasProperty(headers, 'content-type');
```

Passes when `actual` owns `key` directly. Also available on `case.require` for
type narrowing to a record containing that property.

#### `includes(actual, expected)`

Signature: `includes(actual: string, expected: string)`

```ts
case.assert.includes(message, 'saved');
```

Passes when the string `actual` contains `expected`.

#### `instanceOf(actual, ctor)`

Signature: `instanceOf(actual: unknown, ctor: abstract new (...args: never[]) => unknown)`

```ts
case.assert.instanceOf(error, SyntaxError);
```

Passes when `actual instanceof ctor`. Also available on `case.require` for
type narrowing.

#### `length(actual, expectedLength)`

Signature: `length(actual: unknown, expectedLength: number)`

```ts
case.assert.length(rows, 3);
```

Passes when the supported collection count equals `expectedLength`. Supported
values match `empty`.

#### `lessThan(actual, expected)`

Signature: `lessThan(actual: number, expected: number)`

```ts
case.assert.lessThan(durationMs, 500);
```

Passes when `actual` is strictly less than `expected`.

#### `lessThanOrEqual(actual, expected)`

Signature: `lessThanOrEqual(actual: number, expected: number)`

```ts
case.assert.lessThanOrEqual(retryCount, 3);
```

Passes when `actual` is less than or equal to `expected`.

#### `match(actual, pattern)`

Signature: `match(actual: string, pattern: RegExp)`

```ts
case.assert.match(user.email, /^[^@]+@[^@]+$/u);
```

Passes when `pattern.test(actual)` passes.

#### `membersPartialDeepEqual(actual, expectedMembers)`

Signature: `membersPartialDeepEqual<Actual, Expected>(actual: readonly DeepComparable<Actual>[], expectedMembers: readonly DeepComparable<Expected>[])`

```ts
case.assert.membersPartialDeepEqual(users, [
    { id: 'u1', role: 'admin' },
    { id: 'u2', role: 'viewer' },
]);
```

Passes when every expected member has some actual array item that partially
deep-matches it. This checks membership by important fields while allowing
extra actual fields and ignoring array order.

#### `notDeepEqual(actual, expected)`

Signature: `notDeepEqual<Actual, Expected>(actual: DeepComparable<Actual>, expected: DeepComparable<Expected>)`

```ts
case.assert.notDeepEqual(before, after);
```

Passes when `actual` and `expected` are not deeply equal.

#### `notEmpty(actual)`

Signature: `notEmpty(actual: unknown)`

```ts
case.assert.notEmpty(events);
```

Passes when the value has a supported collection count greater than `0`.

#### `notEqual(actual, expected)`

Signature: `notEqual(actual: unknown, expected: unknown)`

```ts
case.assert.notEqual(actualId, previousId);
```

Passes when `Object.is(actual, expected)` does not pass.

#### `notMatch(actual, pattern)`

Signature: `notMatch(actual: string, pattern: RegExp)`

```ts
case.assert.notMatch(output, /deprecated/u);
```

Passes when `pattern.test(actual)` does not pass.

#### `notNull(actual)`

Signature: `notNull(actual: unknown)`

```ts
case.assert.notNull(user);
```

Passes when `actual` is not `null`. Also available on `case.require` for type
narrowing.

#### `null(actual)`

Signature: `null(actual: unknown)`

```ts
case.assert.null(cacheEntry);
```

Passes only when `actual` is exactly `null`. Also available on `case.require`
for type narrowing.

#### `number(actual)`

Signature: `number(actual: unknown)`

```ts
case.assert.number(total);
```

Passes only when `actual` is a number. Also available on `case.require` for
type narrowing.

#### `object(actual)`

Signature: `object(actual: unknown)`

```ts
case.assert.object(payload);
```

Passes when `actual` is a non-null object and not an array. Also available on
`case.require` for type narrowing.

#### `partialDeepEqual(actual, expectedSubset)`

Signature: `partialDeepEqual<Actual, Expected>(actual: DeepComparable<Actual>, expectedSubset: DeepComparable<Expected>)`

```ts
case.assert.partialDeepEqual(user, { profile: { locale: 'en-US' } });
```

Passes when `actual` contains the structure described by `expectedSubset`.
Nested objects, arrays, maps, and sets are matched recursively.

### Deep Assertion Operand Boundary

The `deep*` assertion family is for structural comparison, not primitive
equality. Authoring APIs reject statically known top-level primitive operands,
mixed primitive unions, and `any`. They still accept `unknown` so tests can
compare decoded or otherwise untyped object values without pre-narrowing.

This boundary applies to `deepEqual`, `notDeepEqual`, `partialDeepEqual`,
`arrayContainsPartial`, and `membersPartialDeepEqual`. Primitive leaves inside
objects, arrays, maps, and sets remain valid. Function operands are also valid;
their deep equality semantics are reference-based.

Runtime validation mirrors the authoring rule for values that arrive through
`unknown`, raw assertion nodes, or custom assertions. A primitive top-level
deep operand is a `test-contract` failure with code
`invalid-deep-assertion-operand`, not an assertion mismatch. The diagnostic
identifies the check, operand role, primitive type, and member index when the
invalid value came from a membership helper.

#### `startsWith(actual, expected)`

Signature: `startsWith(actual: string, expected: string)`

```ts
case.assert.startsWith(route, '/api/');
```

Passes when `actual` starts with `expected`.

#### `string(actual)`

Signature: `string(actual: unknown)`

```ts
case.assert.string(name);
```

Passes only when `actual` is a string. Also available on `case.require` for
type narrowing.

#### `true(actual)`

Signature: `true(actual: unknown)`

```ts
case.assert.true(result.ok);
```

Passes only when `actual` is exactly `true`.

#### `undefined(actual)`

Signature: `undefined(actual: unknown)`

```ts
case.assert.undefined(optionalValue);
```

Passes only when `actual` is exactly `undefined`.

#### `case.assert.done()`

Signature: `done()`

```ts
return case.assert.done();
```

Completes builder/result mode and returns the non-empty list of builder
assertions recorded through `case.assert`. It is intentionally not available
on the reusable `case.assert` facade surface.

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
    failures: NonEmptyReadonlyArray<TestFailure>;
};

type Skip = {
    kind: 'skip';
    reason: string;
};

type Inconclusive = {
    kind: 'inconclusive';
    reason: string;
};

type TestFailure =
    | {
        readonly kind: 'assertion';
        readonly checks: NonEmptyReadonlyArray<FailedCheck>;
    }
    | {
        readonly kind: 'body-error';
        readonly error: {
            readonly name: string;
            readonly message: string;
            readonly stack: string | null;
        };
    }
    | {
        readonly kind: 'test-contract';
        readonly code: 'no-assertions' | 'plan-mismatch' | 'invalid-plan';
        readonly message: string;
    };
```

The builder APIs normalize recorded assertion nodes into the same structured
outcomes. Assertion failures, body errors, and test-contract errors stay
separate inside `failures` so reporters can render each cause without parsing
prose.

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

### Low-Level Protocol Versus Day-To-Day API

Overkill benefits from a lazy assertion-node protocol while moving checks
between authoring helpers and the engine. That protocol is public as a
low-level `@overkill-dev/engine` contract for direct engine consumers, but it
does not need a separate first-party package yet.

The public concept therefore stays simpler:

- day-to-day tests use injected `case.assert` / `case.require`
- property helpers such as `case.forall(...)` use a nested injected
  assertion context
- direct returned protocol nodes are assert-source only
- direct returned protocol nodes carry explicit `location` metadata; direct
  authors use `captureSourceLocation()` for accurate lazy locations or
  `unknownSourceLocation` when no source is available
- engine-created require nodes are carried through the test session, count
  toward `plan(n)` once the normal completion has a valid assert-source
  result, and expose `source: 'require'` on failed checks
- the engine evaluates structured `AssertionNode` data into `FailedCheck`
  failures, diffs, and counts without ordinary users constructing protocol
  nodes directly
- a builder test that records assert nodes must return those same node
  objects in order; dropping them is a `dead-builder-assertion` contract
  failure

Custom assertion protocol nodes remain a separate design question. Extension
helpers may wrap built-ins, create composite assertion boundaries, or bridge
foreign assertion systems later, but this concept does not yet choose that
wire shape.

### Assertion Source Locations

`FailedCheck.location` identifies the Overkill assertion boundary that caused
the failed check.

Policy:

- built-in `case.assert.*` and `case.require.*` failures point to that public
  assertion call
- custom, composite, and narrowing failures point to the outer
  `case.assert(reference, ...)` or `case.require(reference, ...)` call
- composite children inherit that same boundary location by default, because
  child checks are diagnostics inside one assertion boundary
- foreign bridge failures use the Overkill boundary location; the thrown
  foreign error keeps its own stack in the structured error diagnostic
- helper and macro forwarding is a separate API decision; the baseline
  captures the immediate assertion boundary

Assertion nodes may carry `SourceLocation` directly or a lazy
`SourceLocationProvider`. Failed checks always expose a concrete
`SourceLocation`.

### Error Separation

The protocol model sharpens an important distinction:

- **assertion failure**: structured test outcome
- **body error**: an ordinary exception or rejection from the test body
- **test-contract error**: invalid assertion protocol usage such as no
  assertions, invalid `plan(n)`, or plan mismatch
- **runner error**: infrastructure failure outside the test outcome path,
  such as reporter failure, crash, permission denial, or runtime failure

This separation is part of the core concept. Assertion failures, ordinary
body errors, and runner infrastructure errors should not travel through the
same path. See [Failure Artifacts](./failure-artifacts.md) and
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

The assertion layer should support imported assertion reference values for
domain-specific assertion vocabulary.

This is especially useful for ecosystems that repeatedly work with wrappers
such as `Result` or `Maybe`.

Primary syntax:

```ts
test('returns a successful result', (case) => {
    case.assert(resultOk, result);
    return case.assert.done();
});
```

Built-in assertions remain named methods:

```ts
case.assert.equal(actual, expected);
case.require.defined(value);
```

Custom assertions should remain:

- explicit imports
- typed values
- engine-branded references
- engine-normalized assertion boundaries

They extend the first-party assertion system without creating registration
order, global availability, or dot-method name collisions.

### Assertion Reference Helpers

The v1 helper surface lives in `@overkill-dev/engine`. A later
`@overkill-dev/assert` package may host or re-export ergonomic helpers.

Assert-only references use `defineCompositeAssertion(...)`:

```ts
import { defineCompositeAssertion } from '@overkill-dev/engine';

export const resultValueDeepEqual = defineCompositeAssertion({
    name: 'resultValueDeepEqual',

    assert(check, result, expected) {
        return check.group([
            check.annotated('ok flag').true(result.ok),
            check.annotated('value').deepEqual(result.value, expected)
        ]);
    }
});
```

Narrowing references use `defineNarrowingCompositeAssertion(...)`:

```ts
export const resultOk = defineNarrowingCompositeAssertion({
    name: 'resultOk',

    narrows(result): result is Ok {
        return result.ok;
    }
});
```

`case.assert(resultOk, result)` checks and continues. `case.require(resultOk,
result)` checks, short-circuits on failure, and narrows the first operand.
Narrowing references are synchronous.

### Composite Assertions

A composite assertion is one named assertion boundary built from one or more
child diagnostics. It is distinct from a test macro:

- a test macro builds `TestNode`s
- a composite assertion stays inside one test body and names one reusable
  invariant

Definition shape:

```ts
import { defineCompositeAssertion } from '@overkill-dev/engine';
import type { TestDouble } from '@overkill-dev/doubles';

const calledOnceWith = defineCompositeAssertion({
    name: 'calledOnceWith',

    assert<TArg>(check, sut: TestDouble<[TArg], unknown>, expected: TArg) {
        return check.group([ check.calledOnce(sut), check.calledWith(sut, expected) ]);
    }
});
```

Composite references are ordinary imported values:

```ts
test('publishes the release', async (case) => {
    await publishRelease(harness, 'v1.2.3');

    case.assert(calledOnceWith, harness.buildAndPublishAll, {
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
    fromThrowable(label: string, body: () => void): unknown;
    fromRejectable(label: string, body: () => Promise<void>): Promise<unknown>;
};
```

That bridge converts a foreign throwable-style assertion callback into one
Overkill assertion boundary:

- success records one passed assertion boundary
- failure records one `FailedCheck`
- thrown foreign errors are normalized into Overkill's structured
  diagnostics
- source location points to the Overkill assertion boundary, not to the
  foreign assertion library internals

The callback may internally run a complex foreign assertion library, but the
Overkill boundary remains explicit and stable.

Example direction:

```ts
import { defineCompositeAssertion } from '@overkill-dev/engine';

export const hasResourceProperties = defineCompositeAssertion({
    name: 'hasResourceProperties',

    assert(check, stack, resourceType, expected) {
        return check.fromThrowable('aws-cdk.assertions.hasResourceProperties', () => {
            const template = Template.fromStack(stack);
            template.hasResourceProperties(resourceType, expected);
        });
    }
});
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

That package should expose assertion references such as:

- `matchesTemplate`
- `hasResource`
- `hasResourceProperties`
- `resourceCountIs`
- `hasOutput`

Usage direction:

```ts
import { hasResourceProperties } from '@overkill-dev/aws-cdk';
```

Then ordinary tests use imported references:

```ts
test('defines versioned bucket', (case) => {
    case.assert(hasResourceProperties, stack, 'AWS::S3::Bucket', {
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
    readonly expected: SerializedValue;
    readonly actual: SerializedValue;
    readonly path: ReadonlyArray<DiffPathSegment>;
    readonly location: SourceLocation;
    readonly diff: Diff | null;
};

type Diff =
    | { kind: 'value'; expected: SerializedValue; actual: SerializedValue; }
    | { kind: 'string'; expected: string; actual: string; hunks: ReadonlyArray<Hunk>; }
    | { kind: 'object'; operations: ReadonlyArray<ObjectDiffOperation>; }
    | { kind: 'array'; operations: ReadonlyArray<ArrayDiffOperation>; }
    | { kind: 'map'; operations: ReadonlyArray<MapDiffOperation>; }
    | { kind: 'set'; operations: ReadonlyArray<SetDiffOperation>; }
    | {
        kind: 'binary';
        expectedSize: number;
        actualSize: number;
        expectedHash: string;
        actualHash: string;
        ranges: ReadonlyArray<ByteDiffRange>;
    };
```

`FailedCheck.actual` and `FailedCheck.expected` are serialized diagnostic
values, not raw assertion operands. The root path is `[]`. Path entries are
typed segments for properties, indexes, map keys, map values, set members, and
byte offsets. Composite checks and foreign checks use `diff: null`; their child
checks or normalized thrown-error payload carry the useful detail.

Rich diffs are emitted only where the engine owns meaningful comparison
semantics: deep assertions, partial assertions, and string `equal` failures.
Plain non-string `equal` failures and failed `notDeepEqual` checks keep
serialized operands with `diff: null`.

Deep comparison uses `Object.is` for primitive leaves, so `NaN` equals `NaN`
and `-0` differs from `+0`. It compares enumerable own string and symbol data
properties, never invokes accessors or `toJSON`, compares class instances only
when their prototype matches, and treats Map and Set comparisons as
order-independent deep matches. Dates compare by time, regexps by source and
flags, errors by name, message, and enumerable data, while Promise, WeakMap, and
WeakSet compare by identity only. Cyclic structures compare by graph topology.

The `binary` kind covers cases where a meaningful structured diff is
not possible — compiled artifacts, encoded media, opaque blobs.
Reporters render it as a size-and-hash summary; the full bytes are
available out-of-band (the baseline files on disk, or attached run
artifacts) for external diff tools. Baseline subtypes that need
richer comparison (visual diff for screenshots, percentile diff for
performance) provide their own adapter-specific representations
above this type — see [Baselines And Snapshots](./baselines-and-snapshots.md).

The engine bounds value serialization before reporters receive the structured
shape. Assertion failure messages are built from user-controlled values, and a
failing deep-equality assertion must not be able to allocate without bound while
constructing diagnostic output.

Default serializer budgets:

- maximum depth: 8
- maximum visited nodes per value: 2,000
- maximum object entries per object: 100
- maximum array entries per array: 100
- maximum string bytes per string: 8 KiB
- maximum serialized bytes per assertion operand: 64 KiB

When a budget is hit, the serialized value includes an explicit truncation
marker with the budget that was reached. Reporters render that marker plainly.
Machine-readable reporters receive the same bounded structured data; they do
not get an unbounded private copy.

Default truncation: 100 lines per diff or 8 KiB per value, whichever is
hit first, with explicit truncation markers in the rendered output. This
reporter cap is in addition to the engine serializer cap above.

## Settled Direction

For the product concept:

- core supports structured assertion results and explicit throwing-mode
  tests
- first-party assertion semantics live in `@overkill-dev/engine`
- reusable assertion reference helpers such as
  `defineCompositeAssertion(...)` live in `@overkill-dev/engine` for v1
- `@overkill-dev/test` may re-expose that engine-owned assertion surface, but it
  is not required for assertion usage
- primary authoring shape: builder/context API with explicit
  `return case.assert.done()`
- `AssertionNode` exists as a public low-level engine protocol, but not as a
  separate package or the day-to-day authoring surface
- zero-assertion detection: failure, no opt-out
- `plan(n)` is the assertion-count contract; no `atMost`, no `atLeast`,
  and `n > 0`
- optional global assertion budgets are allowed as a centrally configured
  policy; they count assertion boundaries, so composite assertions and
  `case.forall(...)` each count as 1
- diff data is structured, not stack-mined, and assertion value formatting is
  resource-bounded before reporter delivery
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
