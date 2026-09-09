# Composition Order

## Position

Many concept documents describe one wrapper or one resolution rule:
test data propagation here, capability intersection there, debug mode
elsewhere, retry handling somewhere else. None of them say _what
happens in what order_ when several apply at once.

This doc names the resolution and execution stack, end to end. It is
a reading aid, not a new mechanism. Every step is already specified
in its domain doc; this file is where they meet.

## Influences

The framing borrows from aspect-oriented programming literature
(AspectJ's joinpoint model, ZIO Test's `@@` aspects, Common Lisp
`:before`/`:after`/`:around` method combination). Overkill doesn't
ship AOP machinery. It does ship test wrappers and test data
resolution that compose, and they need a documented order.

## Resolve-Time Resolution

When the runner starts, before any test body runs, the orchestration
layer resolves the run in this order:

1. **File policy resolution.** The selected profile's `files` policy and
   CLI path operands produce the source file universe. Named file sets are
   validated here, including duplicate names, full-profile overlaps, and
   explicit files outside all sets.
2. **Group ownership resolution.** Grouped work distribution maps named
   file sets to placement groups. File-set references must be valid, a file
   set may be referenced by at most one group, and unreferenced selected
   sets fail unless the distribution explicitly uses `unmatched: 'file'`.
3. **Collection.** Test files are imported; the engine builds the
   `TestNode` tree (suites, tables, test cases). See
   [Tests As Values](../authoring/tests-as-values.md).
4. **Test data propagation.** Parent annotations and controls cascade to
   children. Set-valued annotations merge by union. Controls replace.
   Requirements will own capability and runtime needs once implemented. See
   [Test Data And Selection § Annotations](./test-data-and-selection.md#annotations)
   and [Test Data And Selection § Controls](./test-data-and-selection.md#controls).
5. **Runtime and workload expansion.** Each selected logical `CaseId`
   expands into one or more executable `WorkId`s when runtime matrices,
   browser variants, scenarios, or benchmark workloads apply.
6. **Filter application.** The CLI filter expression (or
   programmatic predicate) is evaluated against resolved annotations
   and identity. Result: a filtered `WorkId` set. See
   [Test Data And Selection § Selection](./test-data-and-selection.md#selection).
7. **Work-unit construction.** The resolved `workDistribution` packs
   filtered `WorkId`s into `WorkUnit`s by file, case, or named group.
8. **Sharding.** `--shard <i>/<n>` partitions the work-unit set
   deterministically by `WorkUnitId` hash. See [Runtime Behavior § Sharding](./runtime-behavior.md#sharding).
9. **Scheduling order.** The filtered, sharded work-unit set is assigned
   an execution order. By default this uses a seeded order recorded
   in `RunFacts`; the run request may opt into lexical
   order. See [Runtime Behavior § Execution Order](./runtime-behavior.md#execution-order).
10. **Resource lowering.** Runtime and resource requirements become
    placement constraints: serial keys, capacity weights, affinity keys,
    fault domains, and required executor capabilities.
11. **Placement planning.** The execution strategy chooses executor lanes,
    worker lifecycle, work-unit assignment, and any deterministic balancing.
    See [Runtime Behavior § Process Model And Scheduling](./runtime-behavior.md#process-model-and-scheduling) and [Package Architecture § Orchestration](./package-architecture.md#orchestration).
12. **Resolution freeze.** The resulting `ResolvedRun` contains
    serializable `RunFacts` for records and replay. Local in-process
    resolution also contains an executable `TestPlan` for
    `execute(testPlan)`. Supervised and other process-boundary
    resolution contains a bodyless collected plan plus frozen work-unit
    assignment that the coordinator can execute without worker-side
    discovery authority.

After step 12, the resolved run does not change. New tests discovered during
execution are an error.

## Execution-Time Wrapping

For each test in the plan, the runner sets up nested wrappers around
the body. Outermost first:

1. **Worker / process boundary.** Capability profile applied via
   Node `--permission` flags. This is process-level: the boundary
   exists for the worker's lifetime, not per test. See
   [Microtests And Capabilities § Capability Defaults](../authoring/microtests-and-capabilities.md#capability-defaults).
2. **Retry loop** (integration profiles only). Wraps the entire
   per-attempt sequence below. Decides after each attempt whether
   to run again. See [Failure Artifacts § Retry Interaction](../authoring/failure-artifacts.md#retry-interaction).
3. **Resource budget supervision.** In supervised process-boundary
   profiles, the parent records the active case and enforces Node-first
   resource budgets. In single-process profiles, this layer is diagnostic
   only. See [Runtime Behavior § Resource Budgets](./runtime-behavior.md#resource-budgets).
4. **Timeout watchdog.** Per-attempt soft and (where supported)
   hard deadlines. Sets up the `AbortSignal` and the optional
   watchdog timer. See [Runtime Behavior § Timeouts](./runtime-behavior.md#timeouts).
5. **Debug recording** (when `--debug` or `--debug-scope` selects the case).
   Begins capturing the timeline, handle events, module loads, heap baseline. See
   [Test Debug Mode](../authoring/debug-mode.md).
6. **Test body.** The actual code under test runs.

Unwinding happens in reverse, innermost first:

1. Body returns, throws, or rejects.
2. Debug recording ends; `TestDebugArtifact` is written.
3. Timeout watchdog cancels its timer.
4. Resource budget supervision records final samples or cancels
   diagnostic tracking.
5. Retry loop inspects the result. On retry, jumps back to step 3
   above (new resource tracking, timeout, debug recording, and attempt).
   On final-result, falls through.
6. Worker boundary remains; the runner moves to the next test in
   this worker.

## Why Two Phases (And What It Costs)

Splitting Plan-Time Resolution (in the main thread) from
Execution-Time Wrapping (in workers or subprocesses) is a deliberate
choice, not just a forced consequence of how worker boundaries work.
The split buys several capabilities:

- `overkill list` prints the resolved facts without executing
  anything - possible only because collection has produced a
  complete resolved run before any worker runs
- `--filter`, `--title`, `--last-failed`, and explicit file/id
  selection apply before
  any test runs; workers receive only the cases that survived
  selection, instead of importing-then-discarding
- `--shard <i>/<n>` partitions deterministically across workers
  because the full plan is known upfront
- seeded random order is part of `RunFacts`, not an execution-time
  accident; replay and failure reports can name the actual realized
  order
- `RunFacts` are recorded as a serializable artifact (per
  [Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects)), enabling replay and
  IDE / MCP introspection without running
- capability profiles, runtime selection, and worker assignment
  resolve once in the main thread, not redundantly per worker
- "resolution freeze is total": dynamically generated tests must be
  discovered at collection (see § Why The Order Matters), which is
  only enforceable if the `TestPlan` is complete before execution starts

The cost is that most parallel modes import each test file **twice**:

1. once in the main thread during collection, to build the `TestNode`
   tree
2. once per worker that's assigned the file, to actually execute the
   test bodies

The runner cannot fold these into one: test bodies are functions, and
Node's `worker_threads` / `child_process` boundaries do not transmit
closures. Workers re-import the file to get executable references.
Supervised profiles that must avoid parent-side user-module execution use
the same rule at a different boundary: a supervised child imports the files
for collection, sends a minimal bodyless collected plan to the coordinator,
then executes only the assigned work identities.

In practice the cost stays small because:

- tests-as-values means import-time work is constructing a
  descriptor tree, not running fixtures or effects (see
  [Principles § Data Over Side Effects](../decisions/principles.md#data-over-side-effects))
- if Overkill enables Node's module compile cache for the
  orchestrator, flushes it after collection, and shares the same
  cache directory with workers, the worker-side re-import can reuse
  V8 code cache and make the second **compilation** cheaper
- per-worker imports parallelize across CPU cores
- the runner targets [Principles § Cold Start Is The Budget](../decisions/principles.md#cold-start-is-the-budget); a
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

- **Debug observes retries.** Each retry attempt produces its own
  debug artifact (sibling files: `attempt=0`, `attempt=1`);
  debug is _inside_ the retry loop, not outside.
- **Timeout fires per attempt, not per test.** A 5 s soft timeout
  on an integration test with 3 retries means up to 15 s of total
  real time, not 5 s.
- **Resource budgets are outside timeout.** A resource breach is
  reported as `resource-exhausted`, not as a timeout, even if the
  same test would later exceed its time budget.
- **Capabilities can't be raised by annotations.** A child test
  cannot grant itself `fs-write` if its parent suite excluded it.
  Intersection is one-way.
- **Filters apply before work-unit sharding.** `--filter '...' --shard 1/4`
  shards the filtered work-unit set, not the full tree. Reproducibility
  depends on this.
- **Work units are built before sharding.** Indivisible groups stay on one
  shard. Profiles that need CI balance choose finer group granularity.
- **Randomization happens before placement assignment.** The seed
  orders work units and breaks balancing ties; execution strategy then maps
  that order onto workers or in-process concurrency.
- **Resolution freeze is total.** Dynamically-generated tests
  (`describe.each` style) must be discovered at collection.
  Generating new tests during execution is rejected at the engine
  layer.

## Adding A New Wrapper

When a new per-test wrapper is added, the question is: where
does it go in the unwinding stack? The answer follows the data
dependency:

- **Inside debug** if it doesn't need to outlive the body's
  timeline (e.g. capability instrumentation).
- **Outside debug, inside timeout** if it should be timed by the
  timeout but excluded from the debug timeline (rare).
- **Outside timeout, inside retry** if it should be cancelled by
  the timeout but survive across retry attempts (e.g. a
  per-test resource lock).
- **Outside retry** if it spans the entire test regardless of
  attempts (e.g. test-level setup/teardown - though Overkill
  currently rejects hooks; resources fill this role; see
  [Higher Test Layers § Resource Factories](../authoring/higher-test-layers.md#1-resource-factories-as-the-main-higher-layer-primitive)).

## What This Doc Is Not

- not a feature; the order described here is what the documentation
  already specifies, just collected
- not a recommendation that user code reach into the wrapping
  stack
- not an aspect-weaving system. There is no joinpoint declaration
  surface, no pointcut DSL, no inter-type advice. Overkill does
  not ship AOP machinery - it ships a small fixed set of wrappers
  and a documented order

## Cross-References

- [Tests As Values](../authoring/tests-as-values.md) - collection and `TestNode`
- [Test Data And Selection](./test-data-and-selection.md) - annotation, control, and filter rules
- [Microtests And Capabilities](../authoring/microtests-and-capabilities.md) - capability intersection
- [Runtime Behavior](./runtime-behavior.md) - sharding, parallelism, timeouts, debug
- [Failure Artifacts](../authoring/failure-artifacts.md) - retry interaction
- [Reproducibility](./reproducibility.md) - `RunFacts` freeze
- [Package Architecture](./package-architecture.md) - orchestration responsibilities
