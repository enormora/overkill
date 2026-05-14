# Composition Order

## Position

Many concept documents describe one wrapper or one resolution rule:
metadata propagation here, capability intersection there, debug mode
elsewhere, retry handling somewhere else. None of them say _what
happens in what order_ when several apply at once.

This doc names the resolution and execution stack, end to end. It is
a reading aid, not a new mechanism. Every step is already specified
in its domain doc; this file is where they meet.

## Influences

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
    [Tests As Values](../authoring/tests-as-values.md).
2.  **Metadata propagation.** Parent suite metadata cascades to
    children. Set-valued fields (`tags`) merge by union;
    array-valued fields (`runtimes`) merge unless `replace: true`;
    enum fields replace. Capabilities **intersect** — children may
    only narrow, not widen. See [Metadata And Selection § Metadata Propagation](./metadata-and-selection.md#metadata-propagation) and [Microtests And Capabilities § Capability Propagation](../authoring/microtests-and-capabilities.md#capability-propagation).
3.  **Filter application.** The CLI filter expression (or
    programmatic predicate) is evaluated against resolved metadata
    and identity. Result: a filtered case set. See
    [Metadata And Selection § Selection Model](./metadata-and-selection.md#selection-model).
4.  **Sharding.** `--shard <i>/<n>` partitions the filtered set
    deterministically by `CaseId` hash. See [Runtime Behavior § Sharding](./runtime-behavior.md#sharding).
5.  **Scheduling order.** The filtered, sharded case set is assigned
    an execution order. By default this is a seeded shuffle recorded
    in the run plan; profiles or CLI flags may opt into lexical
    order. See [Runtime Behavior § Execution Order](./runtime-behavior.md#execution-order).
6.  **Worker assignment.** The execution strategy (resolved from
    profile + resource constraints) decides workers, processes,
    isolation grain. See [Runtime Behavior § Parallelism Semantics](./runtime-behavior.md#parallelism-semantics) and [Package Architecture § Orchestration](./package-architecture.md#orchestration).
7.  **Plan freeze.** The resulting `RunPlan` (see
    [Reproducibility](./reproducibility.md)) is written to the run record and is the
    canonical input for replay.

After step 7, the plan does not change. New tests discovered during
execution are an error.

## Execution-Time Wrapping

For each test in the plan, the runner sets up nested wrappers around
the body. Outermost first:

1.  **Worker / process boundary.** Capability profile applied via
    Node `--permission` flags. This is process-level: the boundary
    exists for the worker's lifetime, not per test. See
    [Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults).
2.  **Retry loop** (integration profiles only). Wraps the entire
    per-attempt sequence below. Decides after each attempt whether
    to run again. See [Failure Artifacts § Retry Interaction](../authoring/failure-artifacts.md#retry-interaction).
3.  **Timeout watchdog.** Per-attempt soft and (where supported)
    hard deadlines. Sets up the `AbortSignal` and the optional
    watchdog timer. See [Runtime Behavior § Timeouts](./runtime-behavior.md#timeouts).
4.  **Debug recording** (when `--debug` / `--debug-scope` /
    `{ debug: true }`). Begins capturing the timeline, handle
    events, module loads, heap baseline. See
    [Test Debug Mode](../authoring/debug-mode.md).
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

## Why Two Phases (And What It Costs)

Splitting Plan-Time Resolution (in the main thread) from
Execution-Time Wrapping (in workers or subprocesses) is a deliberate
choice, not just a forced consequence of how worker boundaries work.
The split buys several capabilities:

-   `overkill list` prints the resolved plan without executing
    anything — possible only because collection has produced a
    complete plan before any worker runs
-   `--filter`, `--name`, `--last-failed`, and explicit file/id
    selection apply before
    any test runs; workers receive only the cases that survived
    selection, instead of importing-then-discarding
-   `--shard <i>/<n>` partitions deterministically across workers
    because the full plan is known upfront
-   seeded random order is part of the plan, not an execution-time
    accident; replay and failure reports can name the actual realized
    order
-   the `RunPlan` is recorded as a serializable artifact (per
    [Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects)), enabling replay and
    IDE / MCP introspection without running
-   capability profiles, runtime selection, and worker assignment
    resolve once in the main thread, not redundantly per worker
-   "plan freeze is total" — dynamically generated tests must be
    discovered at collection (see § Why The Order Matters), which is
    only enforceable if the plan is complete before execution starts

The cost is that in parallel modes each test file is imported
**twice**:

1. once in the main thread during collection, to build the `TestNode`
   tree
2. once per worker that's assigned the file, to actually execute the
   test bodies

The runner cannot fold these into one: test bodies are functions, and
Node's `worker_threads` / `child_process` boundaries do not transmit
closures. Workers re-import the file to get executable references.

In practice the cost stays small because:

-   tests-as-values means import-time work is constructing a
    descriptor tree, not running fixtures or effects (see
    [Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects))
-   if Overkill enables Node's module compile cache for the
    orchestrator, flushes it after collection, and shares the same
    cache directory with workers, the worker-side re-import can reuse
    V8 code cache and make the second **compilation** cheaper
-   per-worker imports parallelize across CPU cores
-   the runner targets [Principles § Cold Start Is The Budget](../decisions/principles.md#cold-start-is-the-budget); a
    second cheap import per file is acceptable, a second expensive
    one is not

In serial modes (single process, single worker) collection and
execution share one import; no second load happens.

`module.enableCompileCache()` does **not** eliminate the duplicate
import itself. It only caches compiled code; it does not transmit
closures across `worker_threads` / `child_process` boundaries, and it
does not suppress top-level module evaluation in the worker. The
worker still imports the file again to obtain executable test-body
references.

If a project's test files do meaningful work at import time
(violating Data Over Side Effects), that cost is paid twice in
parallel mode. Move side-effecting setup into fixtures or test
bodies if startup becomes a concern.

## Why The Order Matters

A few consequences flow from this stack and are easy to get wrong if
the order isn't explicit:

-   **Debug observes retries.** Each retry attempt produces its own
    debug artifact (sibling files: `attempt=0`, `attempt=1`, …);
    debug is _inside_ the retry loop, not outside.
-   **Timeout fires per attempt, not per test.** A 5 s soft timeout
    on an integration test with 3 retries means up to 15 s of total
    real time, not 5 s.
-   **Capabilities can't be raised by metadata.** A child test
    cannot grant itself `fs-write` if its parent suite excluded it.
    Intersection is one-way.
-   **Filters apply before sharding.** `--filter '...' --shard 1/4`
    shards the filtered subset, not the full tree. Reproducibility
    depends on this.
-   **Randomization happens before worker assignment.** The seed
    orders the logical case set first; execution strategy then maps
    that order onto workers or in-process concurrency.
-   **Plan freeze is total.** Dynamically-generated tests
    (`describe.each` style) must be discovered at collection.
    Generating new tests during execution is rejected at the engine
    layer.

## Adding A New Wrapper

When a new per-test wrapper is added, the question is: where
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
    [Higher Test Layers § Resource Factories](../authoring/higher-test-layers.md#1-resource-factories-as-the-main-higher-layer-primitive)).

## What This Doc Is Not

-   not a feature; the order described here is what the documentation
    already specifies, just collected
-   not a recommendation that user code reach into the wrapping
    stack
-   not an aspect-weaving system. There is no joinpoint declaration
    surface, no pointcut DSL, no inter-type advice. Overkill does
    not ship AOP machinery — it ships a small fixed set of wrappers
    and a documented order

## Cross-References

-   [Tests As Values](../authoring/tests-as-values.md) — collection and `TestNode`
-   [Metadata And Selection](./metadata-and-selection.md) — metadata propagation and filters
-   [Microtests And Capabilities](../authoring/microtests-and-capabilities.md) — capability intersection
-   [Runtime Behavior](./runtime-behavior.md) — sharding, parallelism, timeouts, debug
-   [Failure Artifacts](../authoring/failure-artifacts.md) — retry interaction
-   [Reproducibility](./reproducibility.md) — `RunPlan` freeze
-   [Package Architecture](./package-architecture.md) — orchestration responsibilities
