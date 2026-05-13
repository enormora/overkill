# Doubles

## Purpose

This document describes the concept for a future `@overkill/doubles` package.

The goal is not to recreate Sinon. The goal is to provide a small, TypeScript-first way to create explicit test doubles without pushing users toward method patching, module interception, or large mutable mock ecosystems.

## Position

Overkill should treat doubles as a separate first-party package family.

It should be:

-   explicit-injection-first
-   function-double-first
-   TypeScript-first
-   small enough for microtests
-   strong enough for advanced per-call or per-argument behavior

It should not be built around:

-   patching existing object methods
-   module mocking
-   global sandboxes
-   restore registries as the main workflow
-   multiple overlapping user-facing concepts like spy vs fake vs stub

## Recommended Primary Concept

The primary user-facing concept should be `testDouble()`.

Why `testDouble()`:

-   it is explicit at the call site
-   it avoids ambiguity with numeric doubling
-   it still stays close to the package name
-   it leaves room for one concept to cover both simple and advanced cases

## Recommended API Direction

The core should be a typed function double with:

-   a function signature
-   recorded calls and results
-   DX-friendly introspection on the instance itself
-   optional behavior rules
-   an optional fallback answer

The recommendation is to make the primary shape configuration-driven rather than chain-driven.

That does not mean every use must start with a config object. The simple
path should stay very small:

```ts
const log = testDouble().returns(undefined);
const loadUser = testDouble<(id: string) => Promise<User>>().resolves(adminUser);
```

The type argument is the full function signature, not a separate args-tuple plus
return generic. Reading the call site as a function type literal is the most
familiar TypeScript shape, and matchers, `rule.when(...)`, and the answer-function
escape hatch can extract argument and return types via `Parameters<T>` and
`ReturnType<T>` internally without forcing that decomposition into the user-facing
generic.

The intended split is:

-   shorthand instance methods for the common fixed-behavior cases
-   config object plus rule composition for advanced behavior

Example direction:

```ts
import { testDouble, rule } from '@overkill/doubles';

const loadUser = testDouble<(id: string) => Promise<User>>({
    rules: [
        rule.when('admin').resolves(adminUser),
        rule.when('guest').resolves(guestUser),
        rule.onCall(3).rejects(new Error('flaky backend')),
    ],
    fallback: rule.rejects(new Error('unexpected user id')),
});
```

Rule helpers are namespaced under a single `rule` import rather than exported
individually. This avoids shadowing common user-side names like `when` and
`returns`, and keeps the rule-construction surface visible at every call site.
Inside the namespace the shape is fluent: `rule.when(...args)` and
`rule.onCall(n)` start a rule and the terminator (`.returns`, `.resolves`,
`.rejects`, `.throws`, `.calls`) attaches the behavior. Behavior factories
(`rule.returns`, `rule.resolves`, `rule.rejects`, `rule.throws`, `rule.calls`,
`rule.sequence`) are also reachable directly for use in `fallback:` and as
arguments to other helpers.

This gives one concept that handles:

-   simple fixed returns
-   promise resolution and rejection
-   per-call sequencing
-   per-argument behavior
-   fallback behavior for unexpected calls

If no explicit function type is provided, `testDouble()` should still be
valid. The default untyped path should use `unknown` rather than `any`, so
users can start untyped without silently giving up all type safety.

## Introspection Surface

DX-friendly introspection should be a first-class requirement, not an afterthought.

That means a test double instance should expose obvious information directly, for example:

-   `callCount`
-   `calls`
-   `firstCall`
-   `lastCall`
-   `nthCall(n)`
-   `results`
-   `firstResult`
-   `lastResult`

The goal is that a user can inspect a double naturally in a debugger or in an assertion without first learning a large helper API.

Example direction:

```ts
case.assert.equal(saveUser.callCount, 2);
case.assert.equal(saveUser.firstCall.arguments[0].id, '42');
case.assert.equal(saveUser.lastResult.status, 'returned');
```

This is one of the places where Sinon remains strong: the instance objects are easy to inspect. Overkill should preserve that strength while keeping the rest of the API smaller and more coherent.

## Why Not A Sinon-Style Surface

Sinon has useful power, but its surface teaches too many overlapping nouns and too much mutable chaining:

-   `spy`
-   `fake`
-   `stub`
-   `mock`
-   sandbox and restore flows

For Overkill, that is the wrong shape. The package should expose one main concept and a few composable rule helpers.

Most real-world Sinon usage that matters here is already concentrated in a
narrow subset:

-   `fake()`
-   `stub()`
-   `spy()`
-   `.returns(...)`
-   `.resolves(...)`
-   `.rejects(...)`
-   `.throws(...)`
-   `.callsFake(...)`
-   `callCount`
-   `firstCall.args`
-   `secondCall.args`
-   `lastCall.args`
-   `getCall(n)`
-   `calledBefore` / `calledAfter`

That is a much smaller surface than Sinon as a whole, and it supports the
Overkill direction of one main doubles concept instead of category sprawl.

## Suggested Core Pieces

The minimal shape worth exploring is:

-   `testDouble<Fn>(config?)`
-   `rule.when(...args)` for arg-specific rules — fluent terminator attaches behavior
-   `rule.onCall(index)` for ordered rules — fluent terminator attaches behavior
-   `rule.returns(value)`
-   `rule.resolves(value)`
-   `rule.rejects(error)`
-   `rule.throws(error)`
-   `rule.calls(fn)` for fully custom logic (the `answer` config field is the equivalent at the double level)
-   `rule.sequence(...)` for successive results without verbose call-index rules

Example:

```ts
const nextToken = testDouble<() => string>({
    fallback: rule.sequence('a', 'b', rule.throws(new Error('done'))),
});
```

For more advanced cases:

```ts
const authorize = testDouble<(user: string, scope: string) => boolean>({
    answer(call) {
        if (call.args[0] === 'root') return true;
        if (call.args[1] === 'read') return true;
        return false;
    },
});
```

The advanced path should stay in the config object too. It should not require
users to switch to a second primary fluent API:

```ts
const read = testDouble<(path: string) => Promise<string>>({
    rules: [
        rule.onCall(1).resolves('first'),
        rule.onCall(2).resolves('second'),
        rule.when('/missing').rejects(new Error('not found')),
    ],
    fallback: rule.rejects(new Error('unexpected call')),
});
```

## Recommended Mental Model

The mental model should be:

1. create a function-like double
2. give it rules or an answer
3. inject it explicitly
4. assert on its recorded interactions

That is simpler than:

1. decide whether you need a spy, fake, or stub
2. decide whether to patch or inject
3. remember restore semantics
4. mix behavior programming with assertion APIs

## Type Safety

Type safety should be a primary design requirement.

That means:

-   `testDouble<Fn>()` should preserve the full function signature
-   `rule.when()` should type-check argument tuples against `Fn`
-   `rule.returns()` should type-check against the return type of `Fn`
-   `rule.resolves()` and `rule.rejects()` should work naturally for async function signatures
-   recorded calls should preserve the argument tuple type
-   the untyped default should be `unknown`, not `any`

The likely target shape is:

```ts
type UserLoader = (id: string, includeDeleted?: boolean) => Promise<User>;

const loadUser = testDouble<UserLoader>({
    rules: [rule.when('42', true).resolves(user)],
});
```

This should be easier to reason about than matcher-heavy APIs that gradually lose concrete types.

The untyped path is still legitimate for quick tests or gradual migration:

```ts
const writeLine = testDouble().returns(undefined);
```

Typed signatures remain the preferred path when the function contract is part
of what the test cares about.

## `rule.when()` Versus Matchers

`rule.when()` is attractive if it stays concrete and typed.

Recommended direction:

-   prefer exact argument tuples first
-   allow a small set of explicit typed matchers later if needed
-   do not make the whole API depend on broad matcher DSLs from day one

That suggests:

-   exact `rule.when("x", 1).returns("y")`
-   perhaps later `rule.when(match.string, match.number).returns("y")`

The first release concept should not depend on complex matcher machinery.

## Relationship To Assertions

`@overkill/doubles` should create and track doubles.

`@overkill/assert` should remain responsible for assertions about them, such as:

-   call count
-   call arguments
-   returned values
-   thrown errors
-   ordering where that is actually relevant

That separation keeps the doubles package smaller and avoids turning it into a whole framework by itself. The doubles package should still expose rich introspection data directly; the assertion package simply provides a nicer assertion vocabulary on top.

## Relationship To Resources

`@overkill/doubles` should work by explicit injection, so it should compose naturally with `@overkill/resources`.

Examples:

-   a resource can provide a double-backed client
-   a test macro can accept doubles as parameters
-   runtime factories can wire doubles into constructed systems

This is a better fit for Overkill than APIs that replace methods on already-created objects.

## Relationship To Capability Handles

The boundary between `@overkill/doubles` and capability handles —
when to reach for which, how they compose, why both refuse module-graph
patching — is documented in
[Capability Handles § Connection To `@overkill/doubles`](./capability-handles.md#connection-to-overkilldoubles).

Short version: handles model multi-method effect interfaces from a
standard list; `testDouble()` models single-function doubles for
domain-specific collaborators. They compose; a handle's method can be a
`testDouble()`.

## Current Recommendation

Recommended direction:

-   package name: `@overkill/doubles`
-   primary abstraction: `testDouble()`
-   primary API shape: config object plus rule composition
-   strong direct introspection on each instance, such as `callCount`, `firstCall`, `lastCall`, and typed call/result records
-   advanced escape hatch: `answer(call)` config field or `rule.calls(fn)`
-   common-case sugar: instance methods (`.returns`, `.resolves`, `.rejects`, `.throws`) on the simple path; `rule.returns`, `rule.resolves`, `rule.rejects`, `rule.throws`, `rule.sequence` for advanced rules
-   advanced-path behavior still configured through `rules`, `fallback`, and
    `answer` on the config object, with rules built via the `rule.*` namespace
-   no object-method replacement API in the first-party concept
-   no module replacement API in the first-party concept

If future research finds a compelling need for object patching, it should be treated as a separate, more controversial layer rather than folded into the core doubles model.
