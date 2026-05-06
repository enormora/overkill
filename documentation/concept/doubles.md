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

Example direction:

```ts
const loadUser = testDouble<(id: string) => Promise<User>>({
    rules: [
        when('admin', resolves(adminUser)),
        when('guest', resolves(guestUser)),
        onCall(3, rejects(new Error('flaky backend'))),
    ],
    fallback: rejects(new Error('unexpected user id')),
});
```

This gives one concept that handles:

-   simple fixed returns
-   promise resolution and rejection
-   per-call sequencing
-   per-argument behavior
-   fallback behavior for unexpected calls

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
expect(saveUser.callCount).toBe(2);
expect(saveUser.firstCall.arguments[0].id).toBe('42');
expect(saveUser.lastResult.status).toBe('returned');
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

## Suggested Core Pieces

The minimal shape worth exploring is:

-   `testDouble<Fn>(config?)`
-   `when(...args, behavior)` for arg-specific rules
-   `onCall(index, behavior)` for ordered rules
-   `returns(value)`
-   `resolves(value)`
-   `rejects(error)`
-   `throws(error)`
-   `calls(fn)` or `answer(fn)` for fully custom logic
-   `sequence(...)` for successive results without verbose call-index rules

Example:

```ts
const nextToken = testDouble<() => string>({
    fallback: sequence('a', 'b', throws(new Error('done'))),
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
-   `when()` should type-check argument tuples against `Fn`
-   `returns()` should type-check against the return type of `Fn`
-   `resolves()` and `rejects()` should work naturally for async function signatures
-   recorded calls should preserve the argument tuple type

The likely target shape is:

```ts
type UserLoader = (id: string, includeDeleted?: boolean) => Promise<User>;

const loadUser = testDouble<UserLoader>({
    rules: [when('42', true, resolves(user))],
});
```

This should be easier to reason about than matcher-heavy APIs that gradually lose concrete types.

## `when()` Versus Matchers

`when()` is attractive if it stays concrete and typed.

Recommended direction:

-   prefer exact argument tuples first
-   allow a small set of explicit typed matchers later if needed
-   do not make the whole API depend on broad matcher DSLs from day one

That suggests:

-   exact `when("x", 1, returns("y"))`
-   perhaps later `when(match.string, match.number, returns("y"))`

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
-   environment factories can wire doubles into constructed systems

This is a better fit for Overkill than APIs that replace methods on already-created objects.

## Relationship To Capability Handles

The companion concept is **capability handles** (see `capability-handles.md`):
typed bags of effect-performing services (clock, random, filesystem, http,
logger) passed explicitly into code, with recording variants used in tests.

The two packages serve different shapes:

-   a capability-handle helper package, if Overkill ever ships one, would
    provide _recording handles_ for full effect interfaces — `Clock` with
    `now`/`sleep`/`monotonic`, `HttpClient` with `request`/`fetch`, etc.
-   `@overkill/doubles` ships function-level doubles for one-off
    collaborators that are not part of the standard handle set —
    application-specific service interfaces, callback parameters,
    higher-order function arguments

They compose: a handle's method can be a `testDouble()` for fine-grained
per-call control. A test might use an injected runtime object for standard
effects and `testDouble()` for application-specific function-shaped
collaborators.

Both refuse module-graph patching. Both prefer explicit injection. The
boundary is "is this an effect on the standard list or a domain-specific
function?" — handles for the former, doubles for the latter.

## Current Recommendation

Recommended direction:

-   package name: `@overkill/doubles`
-   primary abstraction: `testDouble()`
-   primary API shape: config object plus rule composition
-   strong direct introspection on each instance, such as `callCount`, `firstCall`, `lastCall`, and typed call/result records
-   advanced escape hatch: `answer(call)` or `calls(fn)`
-   common-case sugar: `returns`, `resolves`, `rejects`, `throws`, `sequence`
-   no object-method replacement API in the first-party concept
-   no module replacement API in the first-party concept

If future research finds a compelling need for object patching, it should be treated as a separate, more controversial layer rather than folded into the core doubles model.
