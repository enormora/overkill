# Run Counts

## Purpose

Every Overkill run surfaces two numbers in its summary: how many test
cases the runner discovered, and how many it actually executed. The gap
between them is the first question an author asks when a run does not
look the way they expected — "did all my tests run?" — and the answer
belongs in the standard summary, not behind a debug flag.

The data is informational, not judgmental. A run where `discovered`
exceeds `executed` is normal and often deliberate (selection filters,
sharding, intentional skips). The numbers help authors recognise the
situation; the runner makes no claim about whether the gap is good or
bad.

Run counts also surface a third fact: which test nodes were
_constructed_ during collection but reach no run root — _orphans_. A
test defined and never wired into a `spec`, or a suite fragment
imported and never used, was built but runs nowhere. The runner
reports those nodes; the developer interprets.

## Position

This is an `@overkill/engine` concept. The new fields extend engine's
structured-results contract — `RunResult` and `RunSummary` — and the
engine owns the bookkeeping needed to produce them:

-   the `Constructed` set
-   the `Reached` walk
-   orphan detection
-   per-suite discovered/executed aggregation
-   the final summary fields

`@overkill/run` still owns file discovery and module loading, but once it
hands exported roots to engine, the meaning of run counts is fully engine
owned. `@overkill/test` is not special here; it merely wraps the same
engine-owned node constructors that any other adapter must use if it wants
run-count and orphan-detection support. The default human reporter extends
its run-summary line to surface them. It is **not** an extension of test
debug mode. The
[Test Debug Mode](../authoring/debug-mode.md) is opt-in because of its
per-test telemetry overhead (heap snapshots, module-load hooks,
active-handle deltas). The counts here are cheap: `discovered` and the
per-outcome counts are integers the engine already produces during
plan freeze and run completion, and orphan detection is a set
difference between two collections the engine already holds — an
`O(1)` record per node construction, then one pass at collection end.
None of it carries per-test telemetry overhead, so it all belongs in
the standard run summary, not behind a debug flag.

## Scope

Run counts cover two related questions:

-   **Reachability-bounded counts** — how many cases are reachable
    from the exported test roots, and how many of those the runner
    attempted.
-   **Orphan detection** — which test nodes were constructed during
    collection but reach no run root. See
    [Orphan Detection](#orphan-detection).

Orphan detection is **exact** for everything constructed during
collection, and it reports node identities, not just a count. It does
**not** see nodes in modules that collection never evaluates — a
`test(...)` in a module imported lazily, conditionally, or not at all
is never constructed, so there is no runtime node to detect. That is
not a gap in the count: a node that never came into existence is not a
runtime orphan. The static counterpart is the `no-orphan-test-nodes`
rule in `@overkill/eslint-plugin` (see
[Higher Test Layers § Static Authoring Rules](../authoring/higher-test-layers.md#static-authoring-rules)),
which inspects source rather than a run.

## Data Model

Run counts add two fields to `RunResult.summary` — `discovered` and
`defined` — and two top-level fields to `RunResult` — `bySuite` and
`orphans`. The full shape is documented in
[Types Index](../reference/types-index.md):

```ts
type RunSummary = {
    readonly discovered: number;
    readonly defined: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly inconclusive: number;
};

type RunResult = {
    readonly summary: RunSummary;
    readonly perTest: ReadonlyArray<{ id: CaseId; outcome: TestOutcome; verdict: string }>;
    readonly bySuite: Record<string, { discovered: number; executed: number }>;
    readonly orphans: ReadonlyArray<{ file: string; name: string; kind: 'test' | 'suite' | 'table' }>;
    readonly runnerErrors: ReadonlyArray<RunnerError>;
    readonly artifacts: ReadonlyArray<ArtifactId>;
    readonly wallTimeMs: number;
};
```

### `summary.discovered`

Count of `CaseId`s reachable from the run's test roots, after table
expansion and runtime/workload matrix expansion, **before** filter
application and sharding. In a sharded run this is the global count,
identical on every shard's record.

`executed` at run scope is intentionally not stored as an explicit
field. It is derivable as `passed + failed + skipped + inconclusive + crashed` (where `crashed` is counted from `runnerErrors` with subtype
`crash`). The existing summary has no denormalised fields; run counts
preserve that pattern.

### `summary.defined`

Count of `TestNode`s the constructors built while the runner evaluated
test modules for collection — see
[Definition Of "Defined"](#definition-of-defined). It is a node count,
not an expanded-case count: a `table(...)` is one defined node
regardless of how many rows it carries. `defined` is stored because it
is not derivable from the other summary fields.

### `orphans`

The list of constructed nodes that reach no run root. Each entry names
the source `file`, the node `name`, and its `kind`. `orphaned` at run
scope is not stored — like `executed`, it is derived, here as
`orphans.length`. The list carries identities because "you have 3
orphans" is only actionable together with "...and here they are"; the
mechanism is described in [Orphan Detection](#orphan-detection).

### `bySuite`

Flat map keyed by suite path. Every named grouping in the resolved
tree gets an entry — root suite, intermediate suites, leaf suites, and
tables. Tables are included because they are named groupings that
expand to multiple cases; "did all my round-trip cases run?" is the
same shape of question as "did all my CRUD tests run?".

The canonical internal representation of the key is
`ReadonlyArray<string>`, matching the `suite` field of `TestId` in
[Artifact Identity](./artifact-identity.md). The JSON-serialised form
joins the path with a stable separator for readability:
`'users'`, `'users > validation'`,
`'users > validation > round-trip'`.

Each entry has two integers:

-   `discovered` — count of `CaseId`s reachable from this suite
    (pre-filter, pre-shard, post-expansion).
-   `executed` — count of those cases that received any `TestOutcome`
    or crashed mid-run, on this record's scope (this shard's slice in
    sharded runs).

Suite-scope `executed` is stored explicitly because the per-outcome
breakdown (pass/fail/skip/inconclusive) is **not** denormalised
per-suite. Without an explicit `executed`, the suite-level question
would not be answerable from the run record alone. There is no
per-suite orphan entry: an orphan belongs to no suite, so orphans
exist only at run scope.

## Semantics

### Definition Of "Executed"

A case is counted as `executed` when it received any `TestOutcome`
(pass, fail, skip, inconclusive) or crashed mid-run. Filtered-out and
sharded-out cases do not count because they never entered the final
`RunPlan`.

Skipped tests count as executed: the runner processed them and
recorded a skip verdict. Crashed cases count as executed: the runner
started a body even if the worker died before completion. The rule is
deliberately simple — "the runner got to it, in any way" — and matches
the user question the counts are meant to answer.

### Definition Of "Defined"

A node is _defined_ when one of the engine-owned node constructors
builds it while the runner is evaluating test modules for collection.
Those constructors record each node they produce, with its origin
file, into a run-scoped collection `Constructed`.

This is also where engine enforces node authenticity. `TestNode` is not
"any object with the right shape". Engine constructors brand every node
instance with a private symbol, and engine rejects shape-compatible values
that are missing that brand. That rule lets other adapters benefit from the
same orphan-detection and identity bookkeeping without forcing them through
`@overkill/test`, while still preventing forged plain objects from entering
the run.

`Constructed` is reset when collection starts and is recorded into only during
the collection phase; constructions during test-body _execution_ are
out of scope. Collection happens once, in the orchestrator, before any
worker runs (see [Runtime Behavior](./runtime-behavior.md)), so the
records are written single-threaded and need no synchronisation.

### Sharded Runs

`discovered` is global (the pre-shard count). `executed` is local to
the record's scope. In a `--shard 1/4` run, each shard writes
`discovered: 10000, executed: ~2500`. When shard records are merged
per
[Reproducibility § Run Record Shape](./reproducibility.md#run-record-shape),
the merger takes any shard's `discovered` (they should agree) and
sums `executed` across shards. Per-suite breakdowns merge the same
way: `discovered` is identical on every shard for a given suite;
`executed` sums across shards.

`defined` and `orphans` are global like `discovered`: collection runs
once in the orchestrator before sharding, so every shard's record
carries the same `defined` and the same `orphans`, and the merger
takes any shard's copy.

### Replay

`overkill replay <run-id>` re-runs the recorded plan. `discovered`
matches the original (the plan is fixed). `executed` reflects what
the replay actually ran. `defined` and `orphans` reflect collection,
which replay does not repeat; a replay record carries the original
run's values forward unchanged.

## Orphan Detection

### How It Works

Orphan detection is a set difference between two collections of
authored nodes the runner already has:

-   **`Constructed`** — every node the constructors built during collection, as
    defined in [Definition Of "Defined"](#definition-of-defined).
-   **`Reached`** — every node reachable from the exported run roots.
    The runner already performs this walk; it is the basis of
    `discovered`.

```
orphans = Constructed - Reached    (by node identity)
```

Both sides are authored `TestNode`s, compared by identity. The
canonical orphan is a forgotten test:

```ts
export const someTest = test('some-test', () => {});
export const otherTest = test('other-test', () => {});

export const spec = suite('foo', [someTest]);
```

Both `test(...)` calls run when the module evaluates, so both nodes
are in `Constructed`. Only `someTest` is reachable from `spec`, so only it is in
`Reached`. `otherTest` is in `Constructed - Reached`: it was built and wired into
nothing.

### Why It Is Exact

The comparison is between node-identity sets, never between counts
taken at different pipeline stages. That is what makes it exact where
a bare construction _counter_ is not:

-   **Node reuse.** A node constructed once and placed in two suites
    is one identity in `Constructed` and is in `Reached`, so it is correctly not
    an orphan. A counter would see one construction against two
    reachable cases and underflow.
-   **Matrix expansion.** A `table(...)` that fans out across runtimes
    is one authored node in both `Constructed` and `Reached`. Expansion into many
    `CaseId`s is a planning concern that orphan detection never
    touches, so it cannot distort the result.
-   **Imported-but-unused fragments.** A suite or case imported from a
    helper module and never wired into a root is in `Constructed` but not
    `Reached`, so it is reported as an orphan — correctly. This is real
    information, not noise: "you imported this and used it nowhere" is
    a true fact worth surfacing. The `file` field on each entry says
    where the node was constructed, so an unused import and a
    forgotten local test are distinguishable in the report without
    either being suppressed.
-   **Uncalled macros.** A macro that is defined but never applied
    constructs nothing, so it contributes to neither set — correct,
    there is no node. A macro that is applied but whose result is
    never wired in contributes orphaned nodes — also correct.

Every entry in `Constructed - Reached` is a node that genuinely exists and
genuinely reaches no root. There is no case where the figure is
confidently wrong.

### Relationship To The No-Side-Effects Rule

[Tests As Values](../authoring/tests-as-values.md) rejects
define-by-side-effect: a runner where calling `test(...)` mutates a
hidden registry, and the runner then _reads that registry_ to learn
what tests exist. The poison there is that the registry is
**load-bearing for discovery** — test definitions are not addressable
until every module has been evaluated, call order becomes
significant, and parallel collection races over shared state.

`Constructed` has none of those properties:

-   Discovery does not consult it. The runner still learns the test
    set by walking the exported `spec` value; `Constructed` is never read to
    decide what runs.
-   It is a set, not a sequence. Insertion order does not affect `Constructed`,
    and `Constructed - Reached` is order-independent.
-   It is not the source of truth. The exported `spec` value is
    byte-for-byte identical whether or not `Constructed` exists.
-   Collection runs once, single-threaded, in the orchestrator, so
    nothing races over it.

`Constructed` is runtime-internal engine bookkeeping — recording which
engine-branded nodes were built — used only for diagnostics. It is
the same category as a construction-time call counter: the two differ
only in payload, a set of node identities rather than an integer, not
in kind. If a construction-time count is acceptable, a
construction-time identity set is acceptable for the same reason. What
it does cost is that the constructors are no longer referentially
transparent in the strict sense, and `Constructed` is process state; both are
contained by keeping `Constructed` run-scoped and writing to it only during
single-threaded orchestrator collection.

### Requirements And Edges

-   **Re-evaluation per run.** A constructor records into `Constructed` only
    when it runs, which is on first module evaluation. For `defined`
    and `orphans` to stay accurate across repeated runs in one process
    (watch mode), the runner must re-evaluate test modules each run
    rather than serve them from the module cache. The runner does this
    anyway for test isolation; orphan detection depends on it.
-   **Collection-phase scope.** `Constructed` is recorded into only during
    collection. A `test(...)` call made from inside a running test
    body is not collection-time construction and does not enter `Constructed`.
-   **Retention.** `Constructed` holds references to constructed nodes —
    including ones that would otherwise be unreachable garbage — for
    the duration of collection. The cost is bounded by the size of the
    authored test set and is released once the `RunResult` is
    produced.

## Surfacing

### Always Computed

Counts are always computed and always present in `RunResult.summary`,
`RunResult.bySuite`, and `RunResult.orphans`, regardless of run mode
or flags. No activation surface.

### Persistence

Counts are persisted as part of `RunRecord.result` whenever the run
record is written. Per
[Reproducibility § Run Record Shape](./reproducibility.md#run-record-shape),
the record is written only when an active workflow needs it (replay,
debug retention, coverage, etc.). When no run record is written, the
counts still live in the in-memory `RunResult` consumed by reporters.

### Reporter Rendering

The default human reporter extends its end-of-run summary line to
include `discovered`, and an orphan count when one exists. Suggested
shape:

```
10000 discovered, 9000 executed (8800 pass, 100 fail, 100 skip)  in 4.2s
```

with the orphan count appended when `orphans` is non-empty:

```
10000 discovered, 9000 executed (8800 pass, 100 fail, 100 skip), 3 orphaned  in 4.2s
```

`discovered` and the per-outcome counts render unconditionally, even
when zero, matching the existing summary precedent. The orphan figure
is shown only when non-zero, and when shown the reporter lists the
orphaned nodes (`file`, `name`, `kind`) below the summary line — the
identities are the actionable part, the bare count is not.

Machine-readable reporters (JSON, TAP) emit the full structured data,
including `defined` and the `orphans` list; the per-suite breakdown is
available to consumers that want it.

## What Counts Surface In Practice

Examples of situations the counts make visible:

-   A CI selection filter that accidentally matched a smaller set than
    intended — `discovered` shows the project's full count, `executed`
    shows the smaller actual.
-   A sharded CI run on the wrong shard count — per-shard records show
    the expected division, merged record shows the total.
-   A suite with conditional `skippedTest` where the condition
    accidentally elided more cases than expected — `bySuite[suite]`
    shows the gap localised to one subtree.
-   A test defined but never added to a `spec` — the refactor that
    split one suite into two left a case wired to neither; it appears
    in `orphans` with its file and name.
-   A reusable suite fragment imported but never used — `orphans`
    shows it, with the helper file as its origin, so "how much of this
    catalog is this project actually consuming?" is legible at a
    glance.

The runner never says any of these are _wrong_; it reports the
numbers and identities, and the developer or CI gate interprets.

## Cross-References

-   [Reproducibility § Run Record Shape](./reproducibility.md#run-record-shape)
    — where `RunResult` lives, persistence policy
-   [Tests As Values](../authoring/tests-as-values.md) — the
    reachability rule `Reached` is built on, and the no-side-effects
    rule `Constructed` is reconciled against
-   [Composition Order](./composition-order.md) — the pipeline that
    produces filter and shard narrowing
-   [Runtime Behavior § Sharding](./runtime-behavior.md#sharding) —
    how `discovered` behaves under `--shard`
-   [Reporters](./reporters.md) — reporter contract and event scope
    precedent
-   [Coverage](./coverage.md) — precedent for per-case data in
    `RunRecord`
-   [Higher Test Layers § Static Authoring Rules](../authoring/higher-test-layers.md#static-authoring-rules)
    — the `no-orphan-test-nodes` lint rule, the static-source
    counterpart to runtime orphan detection
-   [Test Debug Mode](../authoring/debug-mode.md) — explicitly _not_
    the home for this concept
