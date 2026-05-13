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

## Position

This is a `@overkill/run` concept that adds fields to `RunResult` and
extends the run-summary line emitted by the default human reporter. It
is **not** an extension of test debug mode. The
[Test Debug Mode](../authoring/debug-mode.md) is opt-in because of its
per-test telemetry overhead (heap snapshots, module-load hooks,
active-handle deltas). The counts here are integers the runner already
produces during plan freeze and run completion, and cost effectively
nothing to emit. They therefore belong in the standard run summary,
not behind a debug flag.

## Scope

Run counts address **reachability-bounded counts**: how many cases are
reachable from the exported test roots, and how many of those the
runner attempted. They do **not** address:

-   **Orphan-in-file detection** — cases authored as `const x = test(...)`
    and never added to any exported `spec`. Catching that would require
    either tracking every constructed `TestNode` (which contradicts the
    [Tests As Values](../authoring/tests-as-values.md) rule that
    detached nodes are a legitimate composition pattern) or static
    analysis. Either is a different tool.
-   **Catalog tests** — cases exported by a project for downstream
    consumers but never reached by any local test entry point. That is
    a static property of the project, not a runtime property of a run,
    and is handled by a separate `overkill audit-catalog` command
    rather than wedged into per-run output.

## Data Model

Run counts add one field to `RunResult.summary` and one top-level
field to `RunResult`. The full shape is documented in
[Types Index](../reference/types-index.md):

```ts
type RunSummary = {
    readonly discovered: number;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly inconclusive: number;
};

type RunResult = {
    readonly summary: RunSummary;
    readonly perTest: ReadonlyArray<{ id: CaseId; outcome: TestOutcome; verdict: string }>;
    readonly bySuite: Record<string, { discovered: number; executed: number }>;
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
field. It is derivable as `passed + failed + skipped + inconclusive +
crashed` (where `crashed` is counted from `runnerErrors` with subtype
`crash`). The existing summary has no denormalised fields; run counts
preserve that pattern.

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
would not be answerable from the run record alone.

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

### Replay

`overkill replay <run-id>` re-runs the recorded plan. `discovered`
matches the original (the plan is fixed). `executed` reflects what
the replay actually ran.

## Surfacing

### Always Computed

Counts are always computed and always present in `RunResult.summary`
and `RunResult.bySuite`, regardless of run mode or flags. No
activation surface.

### Persistence

Counts are persisted as part of `RunRecord.result` whenever the run
record is written. Per
[Reproducibility § Run Record Shape](./reproducibility.md#run-record-shape),
the record is written only when an active workflow needs it (replay,
debug retention, coverage, etc.). When no run record is written, the
counts still live in the in-memory `RunResult` consumed by reporters.

### Reporter Rendering

The default human reporter extends its end-of-run summary line to
include `discovered`. Suggested shape:

```
10000 discovered, 9000 executed (8800 pass, 100 fail, 100 skip)  in 4.2s
```

The behaviour matches the precedent that
`RunResult.summary.passed/failed/skipped/inconclusive` are
unconditionally rendered, even when zero. Hiding `discovered` based on
the size of the gap would be inconsistent with how the rest of the
summary works.

Machine-readable reporters (JSON, TAP) emit the full structured data;
per-suite breakdown is available to consumers that want it.

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
-   Library authors writing reusable suite fragments — counts make
    "how many of these are my own test runs actually consuming?"
    legible at a glance.

The runner never says any of these are _wrong_; it reports the
numbers, and the developer or CI gate interprets.

## Cross-References

-   [Reproducibility § Run Record Shape](./reproducibility.md#run-record-shape)
    — where `RunResult` lives, persistence policy
-   [Tests As Values](../authoring/tests-as-values.md) — the
    reachability rule `discovered` is built on
-   [Composition Order](./composition-order.md) — the pipeline that
    produces filter and shard narrowing
-   [Runtime Behavior § Sharding](./runtime-behavior.md#sharding) —
    how `discovered` behaves under `--shard`
-   [Reporters](./reporters.md) — reporter contract and event scope
    precedent
-   [Coverage](./coverage.md) — precedent for per-case data in
    `RunRecord`
-   [Test Debug Mode](../authoring/debug-mode.md) — explicitly _not_
    the home for this concept
