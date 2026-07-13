# Test Debug Mode

## Purpose

Any test — passing or failing — can be hard to reason about. A
passing test that runs slowly, imports modules its peers don't, or
just barely beats the soft deadline is suspicious. A failing test,
especially one that hit the timeout, is even harder: the test failed,
but _where_ did the time go? Which assertion, which awaited
operation, which import? The runner observes most of that data
per-test and discards it unless explicitly asked to keep it.

**Debug mode is the opt-in switch that keeps the data and emits it
as a structured artifact**, regardless of outcome. For a soft-timeout
failure the timeline turns "this test took too long" into "this
specific awaited handle call took 480 ms of the 500 ms budget" —
which is the difference between a guess and a fix.

The mode is data, not advice. The runner does not annotate, score, or
flag the artifact; the developer reads the timeline and draws the
conclusion. A debug artifact never affects the verdict.

## Activation

Activation is always explicit:

- `--debug-scope <selector>` debugs the tests matching the selector
  (using the same selector grammar as `--filter`) without pulling
  unrelated tests into debug mode and without narrowing what runs.
  It is standalone — it does not require `--debug` — and it is
  mutually exclusive with `--debug`: the two are CLI spellings of one
  underlying setting (`RunPlan.debugMode` `'selected'` versus
  `'all'`), so passing both is a usage error.
- `--debug` debugs every test in the resolved set; pair with
  `--filter`, `--name`, `--id`, or `--file` to scope
- per-test metadata `{ debug: true }` debugs that one test on every
  run, regardless of CLI flags

`--debug-scope` is the typical interactive form: "I want to know what
this _one_ test is doing" while the rest of the run still executes
around it. `--debug` is for run-wide investigations (e.g. "everything
tagged slow").

Activation does **not** change profile, capability boundaries, or
scheduling. A debugged microtest is still a microtest with the same
permissions; debug mode only widens what the runner _records_, not
what the test may _do_. Activation is reflected in the run record
(see `RunPlan.debugMode` / `RunPlan.debuggedCases`) so a replay or
report can tell that the data was collected.

## Artifact Shape

```ts
type TestDebugArtifact = {
    readonly case: CaseId;
    readonly outcome: TestOutcome['kind']; // included so debug artifacts read standalone
    readonly wallTimeMs: number;
    readonly cpuTimeMs: number;
    readonly timeline: ReadonlyArray<TimelineEntry>;
    readonly handleEvents?: ReadonlyArray<RecordedEvent>;
    readonly moduleLoads: ReadonlyArray<{
        readonly specifier: string;
        readonly cachedHit: boolean;
        readonly resolveMs: number;
    }>;
    readonly heap: { beforeBytes: number; afterBytes: number; peakBytes: number; };
    readonly activeHandlesDelta: number;
    readonly plan?: { declared: number; recorded: number; };
    readonly stats: DebugStats;
};

// Pre-computed counts and ratios derived from the rest of the
// artifact. Provided so reporters and CI scripts can scan one-line
// summaries without iterating the timeline.
type DebugStats = {
    readonly assertCount: number;
    readonly requireCount: number;
    readonly handleCallCount: number;
    readonly moduleLoadCount: number;
    readonly uncachedModuleLoadCount: number;
    readonly unaccountedGapMs: number; // wallTime minus measured handle + assertion time
    readonly heapGrowthBytes: number; // afterBytes - beforeBytes
    readonly handleLeakCount: number; // max(0, activeHandlesDelta)
    readonly softTimeoutHeadroomMs: number; // softTimeout - wallTime; negative on timeout failures
};

// Discriminated union — same pattern as RecordedEvent in
// capability-handles.md. `at` is monotonic nanoseconds since the
// test body started; every variant carries it.
type TimelineEntry =
    | { readonly kind: 'body-start'; readonly at: bigint; }
    | { readonly kind: 'assert'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation; }
    | { readonly kind: 'require'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation; }
    | { readonly kind: 'plan'; readonly at: bigint; readonly declared: number; }
    | { readonly kind: 'body-end'; readonly at: bigint; }
    | { readonly kind: 'rejection'; readonly at: bigint; readonly reason: unknown; };
```

Both types are sketched in [Types Index](../reference/types-index.md).

The timeline records discrete events the runner already observes:
body start, each `assert.*` / `require.*` call, `plan()`, body
end or rejection. It deliberately does not record every `await`
boundary — that would require source instrumentation incompatible
with Node's strip-only path. The gaps between timeline entries are
themselves the diagnostic for "where time went": a 480 ms gap
between two adjacent entries is a 480 ms awaited operation. When
the test uses capability handles with recording variants (see
[Capability Handles](./capability-handles.md)), those events are included as
`handleEvents` and pin the awaited operation down to a specific
handle call; tests that do not use recording handles still receive
the rest of the artifact.

## Storage

Debug artifacts live alongside the run record:

```text
.overkill/runs/<run-id>/debug/<case-id-derived>.debug.json
```

They are garbage-collected with the rest of the run record per
[Failure Artifacts § Storage Policy](./failure-artifacts.md#storage-policy).

This is deliberately **not** the default microtest path. A normal
microtest run does not write one artifact file per test case, and it
does not have to persist a run record unless another active workflow
requires one. The ordinary path keeps failure data in memory and in the
reporter/event stream only. Per-test debug files exist solely for tests the user
explicitly put into debug mode (`--debug` or `--debug-scope`), and the
expected microtest workflow is to scope that mode narrowly with
`--debug-scope`, `--id`, `--name`, `--file`, or `--filter`.

## Reporter Interaction

The default reporter adds a one-line summary on each debugged test:

```text
✓ users > round-trip [debug: 380 ms wall, 12 timeline entries, +3 KB heap]
```

Dedicated debug reporters (third-party, packaged separately) consume
the full artifact for richer rendering. The artifact is always on
disk; reporters are a presentation choice.

## Overhead

Debug mode is opt-in because it has cost:

- timestamping each timeline entry is nanoseconds per event but
  accumulates with high event counts
- `process.memoryUsage()` and active-handle snapshots add a few
  microseconds each
- module-load tracking requires a `module.registerHooks#load` hook
  for the run; that hook is not installed when debug is off

These costs are negligible per test but can defeat the cold-start
budget at scale. Debug mode is therefore never on by default and is
not carried across `--watch` reruns unless the user passes `--debug`
again.

## Debugging Failing Tests And Timeouts

Debug mode applies to failures the same way it applies to passes;
the artifact is written either way. Two failure shapes are
particularly worth debugging:

- **Soft-timeout failures.** The test exceeded its deadline. The
  timeline shows which awaited operation consumed the budget;
  `handleEvents` (when present) name the specific handle call.
  "This test is slow" becomes "this `http.request` call took 480
  ms of the 500 ms budget."
- **Assertion failures with surprising timing.** A `fail` outcome
  sits next to a normal-looking timeline; that is information.
  Conversely, a `fail` outcome with one giant gap before the
  failing `assert` points at a slow setup operation that should
  move out of the test body.

For crash failures the artifact is best-effort: the runner flushes
whatever it had recorded up to the crash, marked with a
`rejection`-style final entry. The `WorkerCrash` artifact (see
[Failure Artifacts § Process Crash Artifacts](./failure-artifacts.md#process-crash-artifacts)) remains the
authoritative record.

## Debug Mode And Retries / Replay

When integration-style tests retry (see
[Failure Artifacts § Retry Interaction](./failure-artifacts.md#retry-interaction)), each attempt produces
its own debug artifact: `<case-id>__attempt=0.debug.json`,
`<case-id>__attempt=1.debug.json`, etc. The artifacts are siblings,
not a merged log; comparing them is how you see whether a retry
recovered cleanly or limped.

`overkill replay <run-id>` does **not** automatically re-emit debug
artifacts for the replayed run. The original artifacts already exist
in the source run's directory; replay reads them rather than
regenerating them. To debug a replayed run from scratch, pass
`--debug` (or `--debug-scope`) explicitly on the replay command —
that produces a fresh set in the new run's directory.

## Issues The Artifact Surfaces

Debug mode does not classify tests as good or bad. The artifact is
factual; the _patterns_ below are interpretation guidance — what
specific values _can_ signal, not judgments the runner emits. CI
post-processors, custom reporters, and reviewers turn these signals
into action; the runner stays neutral.

- `stats.assertCount === 0 && stats.requireCount === 0` — the test
  produced no assertions. The engine already fails this case (see
  [Assertions And Results § Zero-Assertion Detection As Default Failure](./assertions-and-results.md#zero-assertion-detection-as-default-failure)); the
  artifact makes the absence visible across runs.
- `stats.handleCallCount === 0` in a profile that expects effects
  — the test exercised no recorded effects. Often intentional for
  pure-logic tests; suspicious when the test name implies I/O.
- `stats.unaccountedGapMs / wallTimeMs > 0.5` — more than half of
  the wall time was not captured by handle calls or assertion
  activity. Suggests external I/O bypassing the handle layer, or
  a slow synchronous block worth profiling.
- `stats.uncachedModuleLoadCount` high — the test pulled in many
  modules from cold; first-run cost may dominate. Look for imports
  inside the body that should move to the file scope.
- `stats.heapGrowthBytes > 0` — the test grew the heap and did not
  return it. Not necessarily a leak (V8 GC is lazy), but worth
  inspection when the value is large or grows across runs.
- `stats.handleLeakCount > 0` — unfinished active handles after
  the body returned. Same data the leak diagnostics in
  [Runtime Behavior § Leaked Promises, Timers, And Handles](../architecture/runtime-behavior.md#leaked-promises-timers-and-handles)
  use, surfaced for any test rather than only on failure.
- `stats.softTimeoutHeadroomMs` close to zero or negative — the
  test is fragile against slower machines or noisy CI hosts. A
  test with 30 ms headroom against a 500 ms soft deadline will
  flake on a busy laptop. Either profile a faster path or
  re-categorise the test.
- Large gaps between adjacent timeline entries — a single awaited
  operation took the time. `handleEvents` near that gap pin it to
  a specific handle call; absence of `handleEvents` says the
  operation went through code the runner does not see (raw
  `fetch`, raw `fs`, etc.).
- `plan.declared !== plan.recorded` — `plan(n)` mismatch. The
  engine fails the test for the same reason; the artifact makes
  the count visible at a glance.

These signals compose: a microtest with `handleCallCount: 0`,
`unaccountedGapMs: 480 ms`, and `softTimeoutHeadroomMs: 20 ms` is
almost certainly doing real I/O it should not be doing in that
profile. The runner reports the numbers; the developer (or a
linter) reads the pattern.

## What This Is Not

- **Not a profiler.** For CPU or call-frame analysis use Node
  `--prof` or `--inspect`. Debug mode tells you what _the test_
  did, not what V8 did.
- **Not a benchmark.** A single-run debug artifact is not
  statistically meaningful; see [Benchmarking](./benchmarking.md) for
  measurement-quality timing.
- **Not advice.** No tips, hints, or recommended actions are
  produced. The artifact reports facts; the developer interprets.
- **Not a verdict input.** Whatever the artifact contains, it never
  affects pass/fail.

## Cross-References

- Capability handle recording is owned by [Capability Handles](./capability-handles.md);
  debug mode aggregates those events into the timeline rather than
  duplicating the recording mechanism.
- The module-load list overlaps with [Fast Feedback Loops § 4. Sharing parsed sources between tests in the same process](../architecture/fast-feedback-loops.md#4-sharing-parsed-sources-between-tests-in-the-same-process), but is
  scoped per test rather than per run.
- Heap and active-handle deltas extend the diagnostics in
  [Runtime Behavior § Leaked Promises, Timers, And Handles](../architecture/runtime-behavior.md#leaked-promises-timers-and-handles),
  made available even when the test passes.
