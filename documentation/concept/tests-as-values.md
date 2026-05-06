# Tests As Values

## Position

Tests-as-values should be the **preferred first-party high-level authoring
mode** in Overkill.

Most JS test runners — Jest, Vitest, Mocha, AVA, `node:test` — treat the act
of calling `describe(...)` and `test(...)` as a side effect of _loading the
module_. The runner imports the file; the imported file mutates a hidden
registry; later the runner walks the registry. The test definitions are not
addressable until the file has been evaluated.

This works, and it has historical reasons (xUnit, RSpec, etc.). It is also
the source of several recurring problems:

-   "discover only" without "execute" requires running the whole import
    graph
-   ordering of `describe` / `test` calls becomes load-bearing in subtle
    ways
-   conditional registration (`if (env) test('only on linux', ...)`) is
    hidden from external tools
-   IDE outlines, MCP servers, mutation testers, coverage UIs all need to
    re-evaluate the file or run a parser to see the test list
-   parallel collection from many files races over the same global registry

The alternative, validated by `elm-test`, Haskell `tasty`, ZIO Test, and
ScalaCheck: **tests are values**. A test file _exports_ a value describing
its tests. The runner imports the module, walks the value, and decides what
to execute.

This should be treated as the first-party answer at the high-level authoring
layer, not as a discarded side experiment.

## What It Looks Like

```ts
import { runIfMain, suite, table, test } from '@overkill/test';

const spec = suite('users', [
    test('build', ({ assert }) => {
        assert.equal(buildUser('Ada').name, 'Ada');
        return assert.done();
    }),

    test('validates', ({ assert }) => {
        assert.fail(buildUser(''), 'empty name');
        return assert.done();
    }),

    table('round-trip', cases, ({ input, expected }, { assert }) => {
        assert.equal(parse(serialize(input)), expected);
        return assert.done();
    }),
]);

export default spec;
await runIfMain(import.meta, spec);
```

The default export is a `Suite` — a plain data tree. The runner does:

```ts
const mod = await import(file);
const tree: TestNode = mod.default;
const plan = orchestrate(tree, filter, profile);
const result = await run(plan);
```

That's it. No registry, no hidden cross-file module-load side effects, no
order dependence on when `test()` happens to be called.

`runIfMain(import.meta, spec)` is the bridge that keeps direct execution
simple. A user should be able to run:

```bash
node source/users.test.ts
```

and get the same execution semantics without giving up the exported value for
tooling.

## Why This Is Better

### Discoverable without executing

`overkill list` walks the exported value. It does not need to execute any
test body, instantiate any fixture, or import any user code beyond evaluating
the module. Listing 10,000 tests across 200 files takes the cost of 200
imports of pure data.

### Programmatic surfaces become trivial

IDE plugins, MCP servers, mutation testers, coverage UIs all consume a
`TestNode` value. There is no parsing of `describe` source, no AST walk, no
re-running with a `--list` flag that re-imports everything.

### Conditional registration is visible

```ts
import { skippedTest, suite, test } from '@overkill/test';

const unameCase =
    process.platform === 'linux'
        ? test('uname', ({ assert }) => {
              assert.equal(runUname(), 'Linux');
              return assert.done();
          })
        : skippedTest('uname', 'not linux');

export default suite('platform', [
    test('linux', linuxOnly, ...),
    unameCase,
]);
```

The condition is just an array element. Filters and reporters see the same
structure. Compare with the imperative version where an `if` around `test()`
silently elides the test from the registry — invisible to listings.

### Ordering is structural

The order of children in a suite is the order they appear in the array.
Sorting, shuffling, sharding all become array operations on a tree, not
side-effects on a global.

### Parallel collection is free

Multiple workers can each `import` a subset of test files and produce their
local trees independently. Merging is concatenation. There is no shared
registry to race over.

### No "global before everything" footgun

Imperative test files often grow a top-level constant that runs once when the
module loads. With tests-as-values, the suite is the only thing that runs at
module load. Anything more expensive lives in fixtures, which the runner
controls.

### Cancellation is structural

The runner walks the tree with an `AbortSignal`. Cancellation aborts the
walk. There is no half-registered global state to clean up.

### Reproducibility improves

Two runs of `overkill list` produce identical output as long as the file's
default export is identical. Imperative registration can produce different
output if module evaluation has any non-determinism.

## The Underlying Type

Sketch of the data model:

```ts
type TestNode = TestCase | Suite | Table;

type TestCase = {
    readonly kind: 'test';
    readonly name: string;
    readonly metadata: Metadata;
    readonly capabilities: ReadonlyArray<Capability>;
    readonly run: (ctx: TestContext) => Promise<TestOutcome> | TestOutcome;
};

type Suite = {
    readonly kind: 'suite';
    readonly name: string;
    readonly metadata: Metadata;
    readonly children: ReadonlyArray<TestNode>;
};

type Table = {
    readonly kind: 'table';
    readonly name: string;
    readonly metadata: Metadata;
    readonly cases: ReadonlyArray<TableCase>;
    readonly run: (case_: TableCase, ctx: TestContext) => Promise<TestOutcome> | TestOutcome;
};
```

`Metadata` and `Capability` are the structures defined in
`metadata-and-selection.md` and `microtests-and-capabilities.md`. The runner
walks the tree, applies filters by metadata, expands tables into individual
cases, and produces an execution plan.

## Relationship To Other DSLs

Other DSLs may still be built on top of the same engine and tree model.

But the first-party stance should stay strict:

-   tests-as-values is the chosen first-party high-level authoring model
-   alternative registration DSLs are valid third-party directions
-   Overkill should not ship several co-equal first-party DSLs at the same
    level

## Macros And Parameterized Tests

A "macro" in Overkill is a function that takes parameters and returns a
`TestNode` (typically a `Suite` or a specialized case-expansion helper). It
is the recommended reuse mechanism for cross-cutting test patterns and the
principal anti-hook tool.

```ts
import { assertion } from '@overkill/assert';
import { suite, test } from '@overkill/test';

function lawsOfMonoid<T>({ name, empty, concat, gen, eq }: MonoidLaws<T>): TestNode {
    return suite(`monoid laws: ${name}`, [
        test('left identity', ({ forall, assert }) => {
            return forall(gen, (x) => assertion.equal(eq(concat(empty, x), x), true));
        }),
        test('right identity', ({ forall, assert }) => {
            return forall(gen, (x) => assertion.equal(eq(concat(x, empty), x), true));
        }),
        test('associativity', ({ forall, assert }) => {
            return forall([gen, gen, gen], ([a, b, c]) =>
                assertion.equal(eq(concat(concat(a, b), c), concat(a, concat(b, c))), true),
            );
        }),
    ]);
}

export default suite('string concat', [lawsOfMonoid({ name: 'string', empty: '', concat: (a, b) => a + b, gen, eq })]);
```

Three properties for free, no boilerplate, fully typed. This is borrowed
directly from cats-laws / scalacheck-laws / `Test.QuickCheck.Classes`. A
single law bundle replaces dozens of example tests.

## Filters Become Tree Walks

`metadata-and-selection.md` describes filtering by tags, file paths, kinds,
and so on. Tests-as-values makes the implementation trivial:

```ts
function selected(node: TestNode, filter: Filter): TestNode | null {
    if (node.kind === 'test') return filter.allows(node.metadata) ? node : null;
    if (node.kind === 'table') return filter.allowsAny(node.metadata) ? node : null;
    const kept = node.children.map((c) => selected(c, filter)).filter(Boolean);
    return kept.length === 0 ? null : { ...node, children: kept };
}
```

Filtering produces a smaller tree. Listing returns the tree. Executing walks
the tree. The same data structure feeds every operation.

## Connection To `import defer`

TC39 `import defer` (Stage 3 as of May 2026, supported syntactically in
TypeScript 5.9, not yet in V8) lets a module declare that an import should
not be evaluated until first access. Combined with tests-as-values:

```ts
import defer * as heavy from './heavy-module.ts';

export default suite('heavy', [
    test('uses heavy', ({ assert }) => {
        assert.equal(heavy.compute(), 42);
        return assert.done();
    }),
]);
```

The import graph for `heavy-module.ts` is _not_ evaluated when the test file
is imported for listing. It only evaluates when the test body runs. Until V8
ships native support, Overkill can simulate this by keeping each test in its
own module and lazy-importing on demand from the runner. Tests-as-values
makes the simulation transparent because the test definitions are pure data
that doesn't need the implementation modules to exist.

## Connection To `results-not-exceptions.md`

Tests-as-values composes with the returned-value outcome model: a test is a
value with a `run` function returning a `TestOutcome` value. Both ends of
the test lifecycle are pure data:

-   the test definition is data (the suite tree)
-   the test result is data (the outcome)

The runner's job is `(SuiteTree, Filter, Profile) -> Promise<RunResult>` —
a function from data to data. No global registry, no thrown exceptions on
the success path, no hidden cross-file registration state.

## Current Product Stance

Overkill should make the value-oriented path strong enough that it does not
need a co-equal first-party registration DSL at the same layer.

The design goal is:

-   engine primitives for very small direct use
-   one preferred first-party value-oriented authoring layer
-   third-party freedom to build alternate DSLs on top of the same engine

This is the cleanest form of the "API-First" principle the overview names.

## Connection To Capability Handles

Tests-as-values + capability handles + recording variants give a fully
deterministic test as a function:

```ts
type TestRun = (input: { runtime: RuntimeHandles; seed: bigint }) => Promise<{
    outcome: TestOutcome;
    effects: ReadonlyArray<RecordedEvent>;
    snapshot: RuntimeSnapshot;
}>;
```

Replaying a test means running this function with the same runtime snapshot
and seed. Recording means saving the resulting snapshot. Determinism comes
out for free because every input is explicit.

## Drawbacks And Mitigations

### "Where do I put a one-off setup statement?"

Some legitimate setup is genuinely one-time and shared across the file. The
answer is _not_ a `before(...)` hook. It is a fixture scoped to the suite, or
an explicit constant inside the suite construction:

```ts
const fixtures = loadFixtures(); // executes at module load — visible

export default suite('users', [
    test('a', ({ assert }) => {
        assert.equal(buildUser(fixtures.a).id, '1');
        return assert.done();
    }),
    test('b', ({ assert }) => {
        assert.equal(buildUser(fixtures.b).id, '2');
        return assert.done();
    }),
]);
```

If the load is expensive, wrap it in a lazy fixture that the suite declares.
Hooks remain rejected.

### "What about long suites?"

A suite of 200 tests in one file becomes a 200-element array. That is fine.
If the array is unwieldy, split into sub-suites or generate via `table` /
macros. Both are pure tree operations.

### "How do I see test errors at registration time?"

In imperative runners, a typo in a test name is visible immediately when the
file loads. With tests-as-values, the file loads even if a test value is
malformed. Mitigation: validate the suite structurally in development mode
on load (cheap), and provide a typed builder so most errors are caught by
TypeScript itself.

### "What about randomized test order?"

The suite array has natural order. Randomized order is a runner concern,
applied to the resolved plan. Reproducibility is preserved by reporting the
seed and the resulting permutation.

## Connection To IDE / MCP / Tooling

Because the test definitions are values, an external tool can:

-   import the file and walk `default` to enumerate tests
-   call `test.run(ctx)` for individual tests with custom context
-   compute a stable identity for each test (file + path-in-tree + name +
    parameterization) without parsing source code
-   diff two runs by comparing tree shapes

This makes Overkill's machine-readable surface (named in
`extensions-and-plugins.md` and `architecture-decisions.md`) genuinely
free, rather than a reporter-output parser kludge.

## Influences

-   Elm `elm-test` — the cleanest existing realization of tests-as-values in
    a popular runner
-   Haskell `tasty` — `TestTree` is the canonical name for the same idea
-   ZIO Test — `Spec[R, E]` values
-   ScalaCheck — `Prop` values
-   Jane Street's `inline_test` — tests are first-class values registered by
    a parsetree extension
-   Rust 1.0+ — `#[test]` produces values consumed by a test harness, not
    registered into a global

## Recommendation

-   `@overkill/engine` exposes `TestNode` as a stable type
-   `@overkill/test` exports `suite`, `test`, `table`, and the imperative
    sugar layer; both produce the same `TestNode` value
-   files export their root node as `default`
-   the runner walks the value; nothing relies on module-load side effects
-   listing, filtering, IDE introspection, MCP servers, and remote
    execution all consume `TestNode` directly

## Sources

-   [elm-test — `Test` and `Expect`](https://package.elm-lang.org/packages/elm-explorations/test/latest/Test)
-   [Haskell `tasty` — `TestTree`](https://github.com/UnkindPartition/tasty)
-   [ZIO Test — `Spec`](https://zio.dev/reference/test/why-zio-test/)
-   [TC39 `import defer` proposal](https://github.com/tc39/proposal-defer-import-eval)
-   [Jane Street `inline_test` documentation](https://blog.janestreet.com/automatically-generated-tests-and-property-based-testing/)
