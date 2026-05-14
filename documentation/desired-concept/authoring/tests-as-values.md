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

This is the authoring-layer expression of [Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects): tests are returned as data, not registered via the act of
loading the module. It should be treated as the first-party answer at
the high-level authoring layer, not as a discarded side experiment.

## What It Looks Like

```ts
import { suite, table, test } from '#tests/micro';

export const spec = suite('users', [
    test('build', (case) => {
        case.assert.equal(buildUser('Ada').name, 'Ada');
        return case.assert.done();
    }),

    test('validates', (case) => {
        case.assert.fail(buildUser(''), 'empty name');
        return case.assert.done();
    }),

    table({
        title: 'round-trip',
        cases,
        caseTitle(parameters) {
            return `should round-trip ${parameters.kind}`;
        },
        test(case) {
            case.assert.equal(
                parse(serialize(case.parameters.input)),
                case.parameters.expected,
            );
            return case.assert.done();
        },
    }),
]);
```

The named export `spec` is a `Suite` — a plain data tree. The runner imports
that value and hands it to orchestration:

```ts
const mod = await import(file);
const tree: TestNode = mod.spec;
await run(tree);
```

That's it. No registry, no hidden cross-file module-load side effects, no
order dependence on when `test()` happens to be called.

That "no registry" claim is about _discovery_: the runner never runs
registration code to learn what tests exist — it reads the exported
value. It does not forbid runtime-internal bookkeeping that discovery
never consults. Run Counts, for instance, has the node constructors
record each constructed node into a run-scoped collection used only to
report orphaned nodes; that collection never feeds discovery and leaves
the exported `spec` unchanged. See
[Run Counts § Orphan Detection](../architecture/run-counts.md#orphan-detection).

For projects that need different authoring surfaces for different suite
families, the preferred import story is a stable alias backed by
`package.json#imports`, for example:

```json
{
    "imports": {
        "#tests/micro": "./testing/micro.ts",
        "#tests/integration": "./testing/integration.ts"
    }
}
```

That keeps test-file imports stable even when different facades expose
different assertion sets or helpers.

An important consequence of this model is that `test(...)`, `table(...)`,
and `suite(...)` are ordinary value constructors. A node may be created
first and attached later:

```ts
const sharedRoundTrip = test('round-trip', (case) => {
    case.assert.equal(parse(serialize(user)), user);
    return case.assert.done();
});

export const spec = suite('users', [
    sharedRoundTrip,
]);
```

That temporary detachment is a feature, not a misuse. The semantic boundary
is **reachability from the exported root**: only nodes reachable from `spec`
participate in the run. Collection, filtering, sharding, and plan freeze
are described in
[Composition Order](../architecture/composition-order.md).

The preferred DX is that direct execution does not require a mandatory
self-run call in every test file. Two direct-file entry paths should be
treated as first-class:

```bash
overkill run source/users.test.ts
```

and:

```bash
node source/users.test.ts
```

The first path preserves the exported value for tooling without requiring
per-file boilerplate. The second path is fully supported through an explicit
authoring helper:

```ts
import { runIfMain, suite, test } from '#tests/micro';

export const spec = suite('users', [
    test('build', (case) => {
        case.assert.equal(buildUser('Ada').name, 'Ada');
        return case.assert.done();
    }),
]);

await runIfMain(import.meta, spec);
```

`runIfMain(...)` is not a second-class escape hatch. It is the supported
companion path for teams that want a test file to behave like an ordinary
Node entrypoint while still exporting the same suite value for tooling.
What the concept rejects is silent bare-`node` auto-detection of a
conventional exported suite value without that explicit helper.

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

### Temporary detached nodes are valid composition

Because tests are plain values, helper modules may expose more nodes than one
consumer uses:

```ts
// helpers/user-cases.ts
export const userCases = {
    roundTrip: test('round-trip', roundTripBody),
    parseError: test('parse error', parseErrorBody),
};

// users.test.ts
import { userCases } from './helpers/user-cases.ts';

export const spec = suite('users', [userCases.roundTrip]);
```

This is valid and intentional. The runner should not treat every constructed
node as an obligation to appear in every final suite tree. What matters is:

-   nodes are plain values that may be named, stored, exported, and reused
-   only nodes reachable from the exported root are part of the run
-   unreachable nodes may be a mistake, but they may also be a legitimate
    unused subset of a reusable catalog

That is why the value-oriented model is preferred over a more restrictive
builder API that tries to make every detached node impossible. The stricter
API would remove a real composition benefit of tests-as-values.

### Conditional registration is visible

```ts
import { skippedTest, suite, test } from '@overkill/test';

const unameCase =
    process.platform === 'linux'
        ? test('uname', (case) => {
              case.assert.equal(runUname(), 'Linux');
              return case.assert.done();
          })
        : skippedTest('uname', 'not linux');

export const spec = suite('platform', [
    test('linux', linuxOnly, ...),
    unameCase,
]);
```

The condition is just an array element. Filters and reporters see the same
structure. Compare with the imperative version where an `if` around `test()`
silently elides the test from the registry — invisible to listings.

### Ordering is structural

The order of children in a suite is the order they appear in the array.
Sorting, shuffling, and other orchestration steps operate on a tree, not on
side-effects in a global registry.

### Parallel collection is free

Multiple workers can each `import` test files and produce local trees
independently. The test-definition model has no shared registry to
race over.

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
exported `spec` is identical. Imperative registration can produce different
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

type ParameterizedTestContext<TParameters> = TestContext & {
    readonly parameters: TParameters;
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
    readonly run: (case_: TableCase, ctx: ParameterizedTestContext<TableCase>) => Promise<TestOutcome> | TestOutcome;
};
```

`Metadata` and `Capability` are the structures defined in
[Metadata And Selection](../architecture/metadata-and-selection.md) and [Microtests And Capabilities](./microtests-and-capabilities.md). The runner
walks the tree. The detailed collection-to-plan pipeline lives in
[Composition Order](../architecture/composition-order.md).

The important typing rule is:

-   plain tests receive `TestContext`
-   parameterized/generated cases receive a refined context with
    `case.parameters`
-   `parameters` is not part of the ordinary top-level case API for
    non-parameterized tests

## Tables As Local Convenience

Tables should exist as a small first-party convenience helper for local
parameterized cases, not as a competing reuse philosophy.

The preferred shape is:

```ts
table({
    title: 'json parser',
    cases,
    caseTitle(parameters, index) {
        return `should parse ${parameters.kind} #${index + 1}`;
    },
    test(case) {
        case.assert.deepEqual(
            parse(case.parameters.input),
            case.parameters.expected,
        );
        return case.assert.done();
    },
});
```

The settled semantics should be:

-   `title` names the table/group
-   `cases` is plain data, not a second row-wrapper DSL
-   `caseTitle` is optional and derives each expanded child case title
-   if `caseTitle` is omitted, Overkill generates deterministic fallback
    names such as `case 1`, `case 2`, ...
-   the callback is named `test` and receives the ordinary `case` object
    refined with `case.parameters`
-   tables are authoring sugar over the same underlying expansion model as
    other parameterized helpers; whether that shares macro machinery
    internally is an implementation detail

After expansion, sibling concrete test titles must be unique. If two table
cases, macro expansions, or generated cases produce the same final sibling
title under one parent suite, collection/planning should fail rather than
silently suffixing or deduplicating them.

Nested suites are intentionally allowed. They are useful for:

-   grouping related behaviors under one named subtree
-   importing reusable suite fragments
-   macro-generated law/contract bundles
-   preserving a meaningful result tree for reporters and selection

But they should stay a **structural** tool, not a lifecycle/setup tool.
Overkill's answer to shared setup is still resources, macros, and explicit
composition rather than ever-deeper nested suite trees pretending to be
fixture scopes.

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

There is no separate runtime "macro object" in the core model. A macro is
just ordinary tree construction.

If a project wants a more explicit declaration form, the first-party
ergonomics layer may also expose optional sugar such as `defineMacro(...)`:

```ts
import { defineMacro, suite, test } from '@overkill/test';

const lawsOfMonoid = defineMacro(
    <T>(parameters: MonoidLaws<T>) => {
        const { name, empty, concat, gen, eq } = parameters;
        return suite(`monoid laws: ${name}`, [
            test('left identity', (case) => {
                return case.forall(gen, (x, sample) => {
                    sample.assert.equal(eq(concat(empty, x), x), true);
                    return sample.assert.done();
                });
            }),
            test('right identity', (case) => {
                return case.forall(gen, (x, sample) => {
                    sample.assert.equal(eq(concat(x, empty), x), true);
                    return sample.assert.done();
                });
            }),
        ]);
    },
);
```

That helper should stay optional sugar only:

-   it does not register anything implicitly
-   it does not change execution semantics
-   plain functions returning `TestNode` remain equally valid macros
-   its value is clearer typing/tooling and a recognizable first-party
    declaration form, not a second macro system

```ts
import { suite, test } from '@overkill/test';

function lawsOfMonoid<T>(parameters: MonoidLaws<T>): TestNode {
    const { name, empty, concat, gen, eq } = parameters;
    return suite(`monoid laws: ${name}`, [
        test('left identity', (case) => {
            return case.forall(gen, (x, sample) => {
                sample.assert.equal(eq(concat(empty, x), x), true);
                return sample.assert.done();
            });
        }),
        test('right identity', (case) => {
            return case.forall(gen, (x, sample) => {
                sample.assert.equal(eq(concat(x, empty), x), true);
                return sample.assert.done();
            });
        }),
        test('associativity', (case) => {
            return case.forall([gen, gen, gen], (values, sample) => {
                const [a, b, c] = values;
                sample.assert.equal(
                    eq(concat(concat(a, b), c), concat(a, concat(b, c))),
                    true,
                );
                return sample.assert.done();
            });
        }),
    ]);
}

export const spec = suite('string concat', [lawsOfMonoid({ name: 'string', empty: '', concat: (a, b) => a + b, gen, eq })]);
```

Three properties for free, no boilerplate, fully typed. This is borrowed
directly from cats-laws / scalacheck-laws / `Test.QuickCheck.Classes`. A
single law bundle replaces dozens of example tests.

## Macro Callsite Metadata

Because macros are plain functions, Overkill has to preserve the authored
callsite deliberately rather than assuming the JavaScript stack will make it
obvious later.

The concept should therefore commit to this rule:

-   node-construction metadata is captured at macro application time
-   listings, failures, and tooling should prefer the macro application site
    over the macro implementation site where practical
-   a generated subtree may have many internal test nodes, but the user-
    authored application call remains the meaningful definition location for
    the bundle as a whole

This is a metadata-capture rule on `test(...)`, `suite(...)`, `table(...)`,
and related helpers, not a reason to invent a second macro runtime type.

## Filters Become Tree Walks

[Metadata And Selection](../architecture/metadata-and-selection.md) describes filtering by tags, file paths, kinds,
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

## Current Product Stance

Overkill should make the value-oriented path strong enough that it does not
need a co-equal first-party registration DSL at the same layer.

The design goal is:

-   engine primitives for very small direct use
-   one preferred first-party value-oriented authoring layer
-   third-party freedom to build alternate DSLs on top of the same engine

This is the cleanest form of the "API-First" principle the overview names.

## Drawbacks And Mitigations

### "Where do I put a one-off setup statement?"

Some legitimate setup is genuinely one-time and shared across the file. The
answer is _not_ a `before(...)` hook. It is a fixture scoped to the suite, or
an explicit constant inside the suite construction:

```ts
const fixtures = loadFixtures(); // executes at module load — visible

export const spec = suite('users', [
    test('a', (case) => {
        case.assert.equal(buildUser(fixtures.a).id, '1');
        return case.assert.done();
    }),
    test('b', (case) => {
        case.assert.equal(buildUser(fixtures.b).id, '2');
        return case.assert.done();
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

## Cross-References

### `import defer`

TC39 `import defer` (Stage 3 as of May 2026, supported syntactically in
TypeScript 5.9, not yet in V8) lets a module declare that an import should
not be evaluated until first access. Combined with tests-as-values:

```ts
import defer * as heavy from './heavy-module.ts';

export const spec = suite('heavy', [
    test('uses heavy', (case) => {
        case.assert.equal(heavy.compute(), 42);
        return case.assert.done();
    }),
]);
```

The import graph for `heavy-module.ts` is _not_ evaluated when the test file
is imported for listing. It only evaluates when the test body runs. Until V8
ships native support, Overkill can simulate this by keeping each test in its
own module and lazy-importing on demand from the runner. Tests-as-values
makes the simulation transparent because the test definitions are pure data
that doesn't need the implementation modules to exist.

### Assertions And Results § Protocol Layer

See [Assertions And Results § Protocol Layer](./assertions-and-results.md#protocol-layer-structured-outcomes).

Tests-as-values composes with the returned-value outcome model: a test is a
value with a `run` function returning a `TestOutcome` value. Both ends of
the test lifecycle are pure data:

-   the test definition is data (the suite tree)
-   the test result is data (the outcome)

The runner's job is `(SuiteTree, Filter, Profile) -> Promise<RunResult>` —
a function from data to data. No global registry, no thrown exceptions on
the success path, no hidden cross-file registration state.

### Capability Handles

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

### IDE / MCP / Tooling

Because the test definitions are values, an external tool can:

-   import the file and walk `default` to enumerate tests
-   call `test.run(ctx)` for individual tests with custom context
-   compute a stable identity for each test (file + path-in-tree + name +
    parameterization) without parsing source code
-   diff two runs by comparing tree shapes

This makes Overkill's machine-readable surface (named in
[Package Architecture § Extension Surfaces](../architecture/package-architecture.md#extension-surfaces)) genuinely
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
