# Composition Order

## Position

Many concept docs describe one wrapper or one resolution rule:
metadata propagation here, capability intersection there, debug mode
elsewhere, retry handling somewhere else. None of them say *what
happens in what order* when several apply at once.

This doc names the resolution and execution stack, end to end. It is
a reading aid, not a new mechanism. Every step is already specified
in its domain doc; this file is where they meet.

## Influence

The framing borrows from aspect-oriented programming literature
(AspectJ's joinpoint model, ZIO Test's `@@` aspects, Common Lisp
`:before`/`:after`/`:around` method combination). Overkill doesn't
ship AOP machinery — it does ship test wrappers and metadata
resolution that compose, and they need a documented order.

## Plan-Time Resolution

When the runner starts, before any test body runs, the orchestration
layer resolves the run plan in this order:

1.  **Collection.** Test files are imported; the engine builds the
    `TestNode` tree (suites, tables, test cases). See
    `tests-as-values.md`.
2.  **Metadata propagation.** Parent suite metadata cascades to
    children. Set-valued fields (`tags`) merge by union;
    array-valued fields (`runtimes`) merge unless `replace: true`;
    enum fields replace. Capabilities **intersect** — children may
    only narrow, not widen. See `metadata-and-selection.md` §
    Metadata Propagation and `microtests-and-capabilities.md` §
    Capability Propagation.
3.  **Filter application.** The CLI filter expression (or
    programmatic predicate) is evaluated against resolved metadata
    and identity. Result: a filtered case set. See
    `metadata-and-selection.md` § Selection Model.
4.  **Sharding.** `--shard <i>/<n>` partitions the filtered set
    deterministically by `CaseId` hash. See `runtime-behavior.md` §
    Sharding.
5.  **Worker assignment.** The execution strategy (resolved from
    profile + resource constraints) decides workers, processes,
    isolation grain. See `runtime-behavior.md` § Parallelism
    Semantics and `package-architecture.md` § Orchestration.
6.  **Plan freeze.** The resulting `RunPlan` (see
    `reproducibility.md`) is written to the run record and is the
    canonical input for replay.

After step 6, the plan does not change. New tests discovered during
execution are an error.

## Execution-Time Wrapping

For each test in the plan, the runner sets up nested wrappers around
the body. Outermost first:

1.  **Worker / process boundary.** Capability profile applied via
    Node `--permission` flags. This is process-level: the boundary
    exists for the worker's lifetime, not per test. See
    `microtests-and-capabilities.md` § Capability Defaults.
2.  **Retry loop** (integration profiles only). Wraps the entire
    per-attempt sequence below. Decides after each attempt whether
    to run again. See `failure-artifacts.md` § Retry Interaction.
3.  **Timeout watchdog.** Per-attempt soft and (where supported)
    hard deadlines. Sets up the `AbortSignal` and the optional
    watchdog timer. See `runtime-behavior.md` § Timeouts.
4.  **Debug recording** (when `--debug` / `--debug-test` /
    `{ debug: true }`). Begins capturing the timeline, handle
    events, module loads, heap baseline. See
    `runtime-behavior.md` § Test Debug Mode.
5.  **Test body.** The actual code under test runs.

Unwinding happens in reverse, innermost first:

1.  Body returns, throws, or rejects.
2.  Debug recording ends; `TestDebugArtifact` is written.
3.  Timeout watchdog cancels its timer.
4.  Retry loop inspects the result. On retry, jumps back to step 3
    above (new timeout, new debug recording, new attempt). On
    final-result, falls through.
5.  Worker boundary remains; the runner moves to the next test in
    this worker.

## Why The Order Matters

A few consequences flow from this stack and are easy to get wrong if
the order isn't explicit:

-   **Debug observes retries.** Each retry attempt produces its own
    debug artifact (sibling files: `attempt=0`, `attempt=1`, …);
    debug is *inside* the retry loop, not outside.
-   **Timeout fires per attempt, not per test.** A 5 s soft timeout
    on an integration test with 3 retries means up to 15 s of total
    real time, not 5 s.
-   **Capabilities can't be raised by metadata.** A child test
    cannot grant itself `fs-write` if its parent suite excluded it.
    Intersection is one-way.
-   **Filters apply before sharding.** `--filter '...' --shard 1/4`
    shards the filtered subset, not the full tree. Reproducibility
    depends on this.
-   **Plan freeze is total.** Dynamically-generated tests
    (`describe.each` style) must be discovered at collection.
    Generating new tests during execution is rejected at the engine
    layer.

## Adding A New Wrapper

When a future feature adds a per-test wrapper, the question is: where
does it go in the unwinding stack? The answer follows the data
dependency:

-   **Inside debug** if it doesn't need to outlive the body's
    timeline (e.g. capability instrumentation).
-   **Outside debug, inside timeout** if it should be timed by the
    timeout but excluded from the debug timeline (rare).
-   **Outside timeout, inside retry** if it should be cancelled by
    the timeout but survive across retry attempts (e.g. a
    per-test resource lock).
-   **Outside retry** if it spans the entire test regardless of
    attempts (e.g. test-level setup/teardown — though Overkill
    currently rejects hooks; resources fill this role; see
    `runtimes-and-fixtures.md`).

This doc should be updated when a new wrapper lands so the stack
stays canonical.

## What This Doc Is Not

-   not a feature; the order described here is what the docs
    already specify, just collected
-   not a recommendation that user code reach into the wrapping
    stack
-   not an aspect-weaving system. There is no joinpoint declaration
    surface, no pointcut DSL, no inter-type advice. Overkill does
    not ship AOP machinery — it ships a small fixed set of wrappers
    and a documented order

## Cross-References

-   `tests-as-values.md` — collection and `TestNode`
-   `metadata-and-selection.md` — metadata propagation and filters
-   `microtests-and-capabilities.md` — capability intersection
-   `runtime-behavior.md` — sharding, parallelism, timeouts, debug
-   `failure-artifacts.md` — retry interaction
-   `reproducibility.md` — `RunPlan` freeze
-   `package-architecture.md` — orchestration responsibilities
