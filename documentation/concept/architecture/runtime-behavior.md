# Runtime Behavior

## Purpose

This document fills in the runtime-shaped concerns most existing concept
docs name only in passing: console capture, exit codes, signal handling,
unhandled rejections, leaked resources, parallelism semantics, sharding,
monorepo discovery, terminal capability detection,
configuration layering, watch-mode targeting.

It is meant to be normative rather than aspirational. Each section states
the default, names the override surface where one exists, and pushes
speculative alternatives into the dedicated future-facing docs instead of
leaving them implicit here.

This document does **not** define a special CI mode. The same invocation
should mean the same thing on a developer machine and in CI; workflow-
specific choices belong in explicit commands or explicit configuration,
not environment-driven runtime branches.

## Console Output Capture

Tests routinely call `console.log`, `console.error`, `process.stdout.write`.
The runner must decide what happens to that output.

Default policy:

-   owned-boundary runs may capture stdout and stderr writes from inside a
    test body and attribute them to the running test
-   same-process runs should not promise universal transparent capture of
    every stdout/stderr write path
-   captured output is preserved as a structured failure artifact (see
    [Failure Artifacts](../authoring/failure-artifacts.md)) — typed as `{ stream: 'stdout' | 'stderr', chunks: ReadonlyArray<{ at: bigint; bytes: Uint8Array }> }`
-   in the default reporter, captured output is **suppressed** for passing
    tests and **printed** for failing tests immediately after the failure
    summary
-   capture has a default cap (e.g. 1 MiB per test) beyond which output is
    truncated with a marker; the cap is configurable

Override surfaces:

-   `--no-capture` — pass everything through live (useful for debugging,
    `console.log` driven exploration)
-   instrumented profiles may observe `console.*` through Node diagnostics
    channels even in same-process runs
-   per-test metadata `{ capture: 'live' }` — opt out for one test
-   reporter-level config — choose to print captured output for passing
    tests as well

Capture must respect orderings within a test. Captured chunks are timestamped
at capture time so reporters can render them interleaved with assertion
events.

Important distinction:

-   boundary capture is the preferred default when the runner owns the worker
    or subprocess
-   same-process console observability may use Node diagnostics channels in
    modern Node
-   arbitrary raw `process.stdout.write(...)` observation still requires
    stronger interception if a profile wants it

## CLI Surface

The full CLI reference (subcommands, flags, and their canonical homes)
lives in [`cli.md`](../reference/cli.md). Behavior of CLI options that bind
specifically to runtime concerns — parallelism, watch mode, debug,
sharding — is documented in this doc; [CLI Reference](../reference/cli.md) cross-links into it.
Selection itself is metadata-driven: tags are a first-class metadata
field, and tag filtering happens through `--filter` expressions such as
`tag=fast` or `!tag=flaky` (see [Metadata And Selection](./metadata-and-selection.md)).

## Exit Codes And `process.exit`

Default exit codes for the `overkill` CLI:

| Outcome                              | Exit code |
| ------------------------------------ | --------- |
| All tests pass and no runner errors  | 0         |
| At least one test failed (assertion) | 1         |
| At least one runner error            | 2         |
| Configuration / argument error       | 3         |
| No tests collected                   | 4         |
| Runner crashed (internal bug)        | 70        |

Test code calling `process.exit(code)` is treated as a runner-level error
and attributed to the currently-running test. The default policy is to
**throw** when the test attempts `process.exit` in a profile that disallows
process termination (microtest profile blocks it via the Node permission
model; integration profile may permit it).

A test profile may opt out of capture-on-exit if the SUT genuinely needs to
test process-exit behavior; that test should run in an isolated subprocess
where `process.exit` is observable as the subprocess exit code.

## Zero-Test Runs

A run that collects zero tests is a **failure** by default. This catches
typos in patterns, broken filters, and accidentally-empty test sets.

There is no escape hatch in the current concept. A workflow that may
legitimately have zero matching tests should make that decision before
invoking Overkill rather than teaching the runner to treat an empty
selection as success.

## Unhandled Rejections And Uncaught Exceptions

Async failures are messy. The runner's policy:

-   any unhandled rejection or uncaught exception emitted **during** a
    test's `run` (including its async tail until the next test starts) is
    attributed to that test as a **runner error** (see
    [Failure Artifacts](../authoring/failure-artifacts.md))
-   any such error after the last test has finished but before the run
    completes is attributed to the run itself
-   any such error from the runner's own machinery is a runner crash

Detection uses `process.on('unhandledRejection')` and
`process.on('uncaughtException')` plus a per-test correlation via
`AsyncLocalStorage` (see [Platform-First Implementation Notes](./platform-first-implementation-notes.md)). The
correlation is best-effort: an async leak that escapes the test's logical
window may be attributed to a sibling test. The runner should warn on
detected attribution drift rather than silently mis-blaming a test.

Tests that intend to test rejection paths use the assertion library's
explicit support (`assert.rejects(promise, expected)`) rather than relying
on the global hooks.

## Signal Handling And Cancellation

`SIGINT` (Ctrl-C) and `SIGTERM` policy:

-   first signal: graceful cancellation. The runner emits an `AbortSignal`
    at the run scope. Each running test sees its `AbortSignal` flip; tests
    are expected to respect it. Reporters flush partial results.
    Resources are disposed in reverse acquisition order.
-   second signal within 5 seconds: hard termination. Workers are killed.
    Partial results are flushed if reachable, otherwise the run exits
    with a runner-error result.
-   third signal: immediate `process.exit(130)`.

Cancellation propagates via `AbortController` chains, in keeping with
[Platform-First Implementation Notes](./platform-first-implementation-notes.md). Tests that ignore the abort
signal cannot be force-killed in-process; supervised profiles can kill the
worker (see [Microtests And Capabilities § Hang Detection And Forced Termination](../authoring/microtests-and-capabilities.md#hang-detection-and-forced-termination)).

## Process Crash Handling

When a worker process dies mid-test (segfault, OOM, native-addon crash):

-   the test that was running is recorded as a runner error with an
    explicit `crash` cause
-   tests already enqueued to that worker are reassigned to other workers
-   the worker is replaced from the pool
-   if crashes exceed a budget (default 3 within a run), the run aborts
    with a runner error to prevent infinite-replay loops

The crash report includes the captured output, the worker's exit signal,
core-dump pointer where available, and the test identity that was active.
This complements [Microtests And Capabilities](../authoring/microtests-and-capabilities.md)'s discussion of crash-
only supervision.

## Leaked Promises, Timers, And Handles

Detection:

-   on-process: `process._getActiveHandles()` and `_getActiveRequests()`
    snapshot before and after each test (in supported profiles); reported
    as resource-leak diagnostics
-   AsyncLocalStorage-instrumented Promise tracking flags Promises whose
    parent test has completed but which are not yet settled
-   the diagnostic is a _warning_ by default and a _failure_ in strict
    profiles

This is the leak-vs-hang split named in [Microtests And Capabilities](../authoring/microtests-and-capabilities.md).
The runner reports leaks as structured diagnostics, not as test failures
unless policy elevates them.

## Timeouts

Tests have two timeout layers: a **soft timeout** that the test body
sees as an aborted `AbortSignal` (cooperative cancellation), and a
**hard timeout** that the runner uses to kill or abandon a wedged
worker (only available in supervised profiles).

Defaults per profile:

| Profile                | Soft timeout     | Hard timeout                                                      |
| ---------------------- | ---------------- | ----------------------------------------------------------------- |
| `microtest`            | 0.5 s            | not available (in-process; no hard recovery from CPU-bound hangs) |
| `microtest-supervised` | 0.5 s            | 1 s (subprocess kill; partial state is discarded)                 |
| `integration-local`    | 5 s              | 7 s (worker terminate)                                            |
| `benchmark`            | per-workload     | 1.5 × workload budget, capped at 60 s (single-worker-serial)      |
| `simulation`           | adapter-declared | adapter-declared                                                  |

Rationale for the tight numbers: tests should be categorised
correctly. A microtest that needs more than 500 ms is misclassified;
an integration-local test that needs more than 5 s is doing real
network I/O it should not be doing. The hard timeouts on supervised
profiles give just enough headroom (~30–40% of soft) for
`AbortSignal`-aware cleanup to actually run before the watchdog kills
the worker.

Override surfaces:

-   per-test metadata: `{ timeout: '500ms' }` shortens the soft
    timeout for one test (cannot extend past the profile's hard
    timeout)
-   profile config overrides set the soft and hard defaults for the
    whole run

Soft-timeout mechanics:

-   the test receives an `AbortSignal` linked to the run scope plus a
    per-test deadline; firing the signal is the runner's first
    cancellation step
-   a test body that does not respect the signal continues running
    until the hard timeout fires (when available) or the worker is
    abandoned at run completion
-   a test that exceeds the soft deadline is a **test failure**, not a
    runner error: the outcome is `fail` with a synthetic `FailedCheck`
    summarising `"exceeded soft timeout <deadline>"`. CI gates
    uniformly on test failures (exit code 1). The runner is never the
    culprit for a slow test — using a slow endpoint or doing extensive
    I/O in a profile that should not is a test-author error.

Hard-timeout mechanics:

-   only available in profiles that own a worker or subprocess
    boundary (supervised microtests, integration-local with workers,
    benchmark, simulation)
-   the watchdog terminates the worker after the hard timeout; the
    test is recorded as `crashed`
-   crash-budget rules (`Process Crash Handling`) apply

In-process modes intentionally lack hard termination — see
[Microtests And Capabilities § Hang Detection And Forced Termination](../authoring/microtests-and-capabilities.md#hang-detection-and-forced-termination) for the rationale and supervised-profile alternative.

## Test Debug Mode

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

### Activation

Activation is always explicit:

-   `--debug-test <id-or-pattern>` debugs one specific test (or
    several matching the same selector grammar as `--filter`) without
    pulling unrelated tests into debug mode
-   `--debug` debugs every test in the resolved set; pair with
    `--filter`, `--name`, `--id`, or `--file` to scope
-   per-test metadata `{ debug: true }` debugs that one test on every
    run, regardless of CLI flags

`--debug-test` is the typical interactive form: "I want to know what
this _one_ test is doing." `--debug` is for run-wide investigations
(e.g. "everything tagged slow").

Activation does **not** change profile, capability boundaries, or
scheduling. A debugged microtest is still a microtest with the same
permissions; debug mode only widens what the runner _records_, not
what the test may _do_. Activation is reflected in the run record
(see `RunPlan.debugMode` / `RunPlan.debuggedCases`) so a replay or
report can tell that the data was collected.

### Artifact Shape

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
    readonly heap: { beforeBytes: number; afterBytes: number; peakBytes: number };
    readonly activeHandlesDelta: number;
    readonly plan?: { declared: number; recorded: number };
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
    | { readonly kind: 'body-start'; readonly at: bigint }
    | { readonly kind: 'assert'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation }
    | { readonly kind: 'require'; readonly at: bigint; readonly label?: string; readonly location?: SourceLocation }
    | { readonly kind: 'plan'; readonly at: bigint; readonly declared: number }
    | { readonly kind: 'body-end'; readonly at: bigint }
    | { readonly kind: 'rejection'; readonly at: bigint; readonly reason: unknown };
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
[Capability Handles](../authoring/capability-handles.md)), those events are included as
`handleEvents` and pin the awaited operation down to a specific
handle call; tests that do not use recording handles still receive
the rest of the artifact.

### Storage

Debug artifacts live alongside the run record:

```
.overkill/runs/<run-id>/debug/<case-id-derived>.debug.json
```

They are garbage-collected with the rest of the run record per
[Failure Artifacts § Storage Policy](../authoring/failure-artifacts.md#storage-policy).

This is deliberately **not** the default microtest path. A normal
microtest run does not write one artifact file per test case. The
ordinary path keeps failure data in the run record and reporter/event
stream only. Per-test debug files exist solely for tests the user
explicitly put into debug mode (`--debug` or `--debug-test`), and the
expected microtest workflow is to scope that mode narrowly with
`--debug-test`, `--id`, `--name`, `--file`, or `--filter`.

### Reporter Interaction

The default reporter adds a one-line summary on each debugged test:

```
✓ users > round-trip [debug: 380 ms wall, 12 timeline entries, +3 KB heap]
```

Dedicated debug reporters (third-party, packaged separately) consume
the full artifact for richer rendering. The artifact is always on
disk; reporters are a presentation choice.

### Overhead

Debug mode is opt-in because it has cost:

-   timestamping each timeline entry is nanoseconds per event but
    accumulates with high event counts
-   `process.memoryUsage()` and active-handle snapshots add a few
    microseconds each
-   module-load tracking requires a `module.registerHooks#load` hook
    for the run; that hook is not installed when debug is off

These costs are negligible per test but can defeat the cold-start
budget at scale. Debug mode is therefore never on by default and is
not carried across `--watch` reruns unless the user passes `--debug`
again.

### Debugging Failing Tests And Timeouts

Debug mode applies to failures the same way it applies to passes;
the artifact is written either way. Two failure shapes are
particularly worth debugging:

-   **Soft-timeout failures.** The test exceeded its deadline. The
    timeline shows which awaited operation consumed the budget;
    `handleEvents` (when present) name the specific handle call.
    "This test is slow" becomes "this `http.request` call took 480
    ms of the 500 ms budget."
-   **Assertion failures with surprising timing.** A `fail` outcome
    sits next to a normal-looking timeline; that is information.
    Conversely, a `fail` outcome with one giant gap before the
    failing `assert` points at a slow setup operation that should
    move out of the test body.

For crash failures the artifact is best-effort: the runner flushes
whatever it had recorded up to the crash, marked with a
`rejection`-style final entry. The `WorkerCrash` artifact (see
[Failure Artifacts § Process Crash Artifacts](../authoring/failure-artifacts.md#process-crash-artifacts)) remains the
authoritative record.

### Debug Mode And Retries / Replay

When integration-style tests retry (see
[Failure Artifacts § Retry Interaction](../authoring/failure-artifacts.md#retry-interaction)), each attempt produces
its own debug artifact: `<case-id>__attempt=0.debug.json`,
`<case-id>__attempt=1.debug.json`, etc. The artifacts are siblings,
not a merged log; comparing them is how you see whether a retry
recovered cleanly or limped.

`overkill replay <run-id>` does **not** automatically re-emit debug
artifacts for the replayed run. The original artifacts already exist
in the source run's directory; replay reads them rather than
regenerating them. To debug a replayed run from scratch, pass
`--debug` (or `--debug-test`) explicitly on the replay command —
that produces a fresh set in the new run's directory.

### Issues The Artifact Surfaces

Debug mode does not classify tests as good or bad. The artifact is
factual; the _patterns_ below are interpretation guidance — what
specific values _can_ signal, not judgments the runner emits. CI
post-processors, custom reporters, and reviewers turn these signals
into action; the runner stays neutral.

-   `stats.assertCount === 0 && stats.requireCount === 0` — the test
    produced no assertions. The engine already fails this case (see
    [Assertions And Results § Zero-Assertion Detection As Default Failure](../authoring/assertions-and-results.md#zero-assertion-detection-as-default-failure)); the
    artifact makes the absence visible across runs.
-   `stats.handleCallCount === 0` in a profile that expects effects
    — the test exercised no recorded effects. Often intentional for
    pure-logic tests; suspicious when the test name implies I/O.
-   `stats.unaccountedGapMs / wallTimeMs > 0.5` — more than half of
    the wall time was not captured by handle calls or assertion
    activity. Suggests external I/O bypassing the handle layer, or
    a slow synchronous block worth profiling.
-   `stats.uncachedModuleLoadCount` high — the test pulled in many
    modules from cold; first-run cost may dominate. Look for imports
    inside the body that should move to the file scope.
-   `stats.heapGrowthBytes > 0` — the test grew the heap and did not
    return it. Not necessarily a leak (V8 GC is lazy), but worth
    inspection when the value is large or grows across runs.
-   `stats.handleLeakCount > 0` — unfinished active handles after
    the body returned. Same data the leak diagnostics in § Leaked
    Promises, Timers, And Handles use, surfaced for any test rather
    than only on failure.
-   `stats.softTimeoutHeadroomMs` close to zero or negative — the
    test is fragile against slower machines or noisy CI hosts. A
    test with 30 ms headroom against a 500 ms soft deadline will
    flake on a busy laptop. Either profile a faster path or
    re-categorise the test.
-   Large gaps between adjacent timeline entries — a single awaited
    operation took the time. `handleEvents` near that gap pin it to
    a specific handle call; absence of `handleEvents` says the
    operation went through code the runner does not see (raw
    `fetch`, raw `fs`, etc.).
-   `plan.declared !== plan.recorded` — `plan(n)` mismatch. The
    engine fails the test for the same reason; the artifact makes
    the count visible at a glance.

These signals compose: a microtest with `handleCallCount: 0`,
`unaccountedGapMs: 480 ms`, and `softTimeoutHeadroomMs: 20 ms` is
almost certainly doing real I/O it should not be doing in that
profile. The runner reports the numbers; the developer (or a
linter) reads the pattern.

### What This Is Not

-   **Not a profiler.** For CPU or call-frame analysis use Node
    `--prof` or `--inspect`. Debug mode tells you what _the test_
    did, not what V8 did.
-   **Not a benchmark.** A single-run debug artifact is not
    statistically meaningful; see [Benchmarking](../authoring/benchmarking.md) for
    measurement-quality timing.
-   **Not advice.** No tips, hints, or recommended actions are
    produced. The artifact reports facts; the developer interprets.
-   **Not a verdict input.** Whatever the artifact contains, it never
    affects pass/fail.

### Connections

-   Capability handle recording is owned by [Capability Handles](../authoring/capability-handles.md);
    debug mode aggregates those events into the timeline rather than
    duplicating the recording mechanism.
-   The module-load list overlaps with [Fast Feedback Loops § 4. Sharing parsed sources between tests in the same process](./fast-feedback-loops.md#4-sharing-parsed-sources-between-tests-in-the-same-process), but is
    scoped per test rather than per run.
-   Heap and active-handle deltas extend the diagnostics in § Leaked
    Promises, Timers, And Handles, made available even when the test
    passes.

## Parallelism Semantics

Parallelism happens at multiple grains. The default for `@overkill/test`
is **concurrent-in-process with seeded randomized scheduling**. Other
modes remain available when the suite or resource model calls for them:

| Mode                    | Description                                           | When useful                                         |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `serial`                | One test at a time, single process                    | deterministic simulation, debugger-focused runs     |
| `concurrent-in-process` | Multiple tests' async work interleaves in one process | default for microtests                              |
| `worker-pool`           | N worker threads, file-level distribution             | CPU-bound suites, big monorepos                     |
| `process-per-file`      | Subprocess per test file                              | strong isolation, capability resets, native crashes |
| `single-worker-serial`  | Single worker thread, no concurrency                  | benchmarks, deterministic-simulation                |

Rationale for the default:

-   microtests should surface accidental coupling early; a concurrent
    default is better at exposing hidden dependence on ambient global state,
    fake timers, console ordering assumptions, and resource ownership leaks
-   same-process concurrency preserves the low cold-start budget while still
    allowing unrelated async work to overlap
-   strict serialization remains useful, but it is a debugging and
    determinism tool rather than the default shape for the suite
-   tests that genuinely require serialization should declare it through
    resources or run under `--mode serial`, rather than relying on an
    implicitly serialized suite

Selection rules:

-   the runner profile names a default mode
-   resource execution requirements ([Runtimes And Fixtures](../authoring/runtimes-and-fixtures.md)) can
    upgrade the mode (e.g. exclusive resource forces serialization within
    its scope)
-   `--mode` overrides at the CLI

## Execution Order

Execution order is a scheduling concern, not a property of source-file
layout. The default scheduler is **seeded random order**:

-   after collection, metadata propagation, filtering, and sharding, the
    selected case set is shuffled by a recorded seed
-   if the user does not pass `--seed <value>`, the runner chooses one,
    prints it, and writes it into the `RunPlan` and final `RunRecord`
-   rerunning with the same seed and the same filtered case set reproduces
    the same order
-   resources or execution constraints may force local serialization, but
    they do not silently disable seeded ordering for unrelated tests

Why randomize by default:

-   fixed lexical order hides order-dependent tests for too long
-   a seed gives reproducibility without giving up the ability to shake out
    unwanted coupling
-   the randomization happens at plan time, so IDEs, replay, and failure
    artifacts can all report the exact realized order

Override surfaces:

-   `--seed <value>` selects a specific shuffle
-   `--order lexical` disables shuffling and uses deterministic collection
    order
-   runner profiles may choose stricter scheduling only where the test
    family actually requires it (for example benchmarks)

Default worker count is `Math.min(cpus().length - 1, 8)` for worker-pool
modes, capped to keep the host responsive. Override via `--workers N`.

## Sharding

`--shard <i>/<n>` selects shard `i` of `n`. Sharding partitions the
collected test set deterministically by stable test identity (see
[Artifact Identity](./artifact-identity.md)), so two shards never share a test and the union
covers everything. The partition is reproducible across runs given the
same identities.

Sharding composes with selection: filters apply first, sharding applies to
the filtered set.

CI integration: GitHub Actions, GitLab, and CircleCI matrices map directly
to `--shard`. Reporters can merge per-shard JSON outputs into a single
final report.

## Terminal Capability Detection

Moved to [CLI Reference § Terminal Capability Detection](../reference/cli.md#terminal-capability-detection) — those rules
(color, animation, progress UI, terminal width) are CLI- and
reporter-scoped, not runtime concerns.

## Configuration Layering

Project policy should come from config files, not from overlapping config
channels.

Canonical shape:

-   one root `overkill.config.ts` defines project policy
-   in a monorepo, package-level config files may extend that root policy
    where the workspace concept genuinely needs per-package differences
-   built-in defaults fill gaps, but there is no second user-level config
    layer and no parallel environment-variable config surface

The only configuration-oriented CLI flag should be `--config <path>` to pick
the config file location explicitly when discovery is not enough.

Important distinction:

-   config files define project policy
-   ordinary CLI selection and run-intent flags such as `--file`, `--name`,
    `--id`, `--seed`, or `--shard` are still valid because they are not a
    second configuration channel; they are one run request against that
    policy

Config files are TS modules exporting a default config value. The runner
imports them via the same loader pipeline as test files (Node type
stripping). No JSON or YAML schema; types over schema.

Where package-level config exists, it should extend the root config through
typed composition rather than by inventing unrelated ad-hoc precedence
rules.

## Watch-Mode Targeting

Watch mode should stay simple by default and lean on Node `--watch`.

Default behavior:

-   a watched rerun reruns the selected suite again
-   no custom module-graph logic is assumed in the default concept

If Overkill later adds smarter related-test reruns, that should be treated as
an optional enhancement rather than the baseline promise.

## Source Maps In Failure Stacks

With Node's built-in type stripping, ordinary TypeScript source locations
should already be good enough in the common path. Overkill should not assume a
custom source-map story unless a specific transform path requires it.

## Encoding And Locale

The runner forces `LC_ALL=C.UTF-8`-equivalent behavior internally for
deterministic sort and number formatting in reports. User code is not
affected. Test output is captured as bytes; rendering decodes as UTF-8.

## Network And Filesystem Defaults

By profile ([Microtests And Capabilities](../authoring/microtests-and-capabilities.md) enumerates):

-   microtest: deny FS write, deny net, deny child process, deny worker
-   integration-local: allow FS write within a per-test temp dir, allow
    loopback net, allow child process
-   benchmark: allow as integration-local but with single-worker
    serialization

The temp-dir convention is `os.tmpdir() + /overkill-<run-id>/<test-id>/`,
created lazily per test, removed on test completion (or run completion in
debug mode). This is one of the runner-owned escape hatches named in
[Microtests And Capabilities](../authoring/microtests-and-capabilities.md).

## Connection To Other Docs

This document is the runtime counterpart to several others. Cross-links:

-   [Microtests And Capabilities](../authoring/microtests-and-capabilities.md) — capability profiles, hang
    detection, supervision
-   [Failure Artifacts](../authoring/failure-artifacts.md) — output capture, runner-error vs test-failure
    distinction
-   [Metadata And Selection](./metadata-and-selection.md) — selection rules sharding composes with
-   [Fast Feedback Loops](./fast-feedback-loops.md) — watch mode and cache behavior
-   [Platform-First Implementation Notes](./platform-first-implementation-notes.md) — `AbortSignal`, source maps,
    `AsyncLocalStorage`
-   [Package Architecture](./package-architecture.md) — execution strategy decisions live in
    `@overkill/run`; this doc names the resulting runtime defaults

## Resolved Edge Policies

-   unhandled async errors are attributed to the originating test when the
    runner can correlate them through owned task or async-resource context;
    otherwise they are run-level runner errors labeled as unattributed async
    leaks. The runner should not guess and blame a sibling test by timing
    alone.
-   strict microtest profiles elevate leaked resources to failures by
    default. Integration and benchmark-oriented profiles report leaks as
    runner diagnostics by default, with policy able to escalate them.
-   monorepo cross-package fixture sharing is only valid through explicit
    run-scope or shared resource definitions. It is never inferred from
    package layout or discovery.
-   sharding for dynamic test generation works by collecting once, freezing
    the resolved identities, and partitioning that collected set. Overkill
    should not independently recollect dynamic test trees on each shard and
    hope they match.
