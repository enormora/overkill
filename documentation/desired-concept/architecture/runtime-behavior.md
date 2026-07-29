# Runtime Behavior

## Purpose

This document fills in the runtime-shaped concerns most existing concept
documentation names only in passing: console capture, exit codes, signal handling,
unhandled rejections, leaked resources, resource budgets, parallelism semantics,
sharding, monorepo discovery, terminal capability detection, watch-mode
targeting.

It is meant to be normative rather than aspirational. Each section states
the default and names the override surface where one exists instead of
leaving important runtime behavior implicit.

This document does **not** define a special CI mode. The same invocation
should mean the same thing on a developer machine and in CI; workflow-
specific choices belong in explicit commands or explicit configuration,
not environment-driven runtime branches.

## Console Output Capture

Tests routinely call `console.log`, `console.error`, `process.stdout.write`.
The runner must decide what happens to that output.

Default policy:

- owned-boundary runs may capture stdout and stderr writes from inside a
  test body and attribute them to the running test
- same-process runs should not promise universal transparent capture of
  every stdout/stderr write path
- captured output is preserved as a structured failure artifact (see
  [Failure Artifacts](../authoring/failure-artifacts.md)) — typed as `{ stream: 'stdout' | 'stderr', chunks: ReadonlyArray<{ at: bigint; bytes: Uint8Array }> }`
- in the default reporter, captured output is **suppressed** for passing
  tests and **printed** for failing tests immediately after the failure
  summary
- capture has a default cap (e.g. 1 MiB per test) beyond which output is
  truncated with a marker; the cap is configurable

Override surfaces:

- `--no-capture` — pass everything through live (useful for debugging,
  `console.log` driven exploration)
- instrumented profiles may observe `console.*` through Node diagnostics
  channels even in same-process runs
- per-test metadata `{ capture: 'live' }` — opt out for one test
- reporter-level configuration — choose to print captured output for passing
  tests as well

Capture must respect orderings within a test. Captured chunks are timestamped
at capture time so reporters can render them interleaved with assertion
events.

Important distinction:

- boundary capture is the preferred default when the runner owns the worker
  or subprocess
- same-process console observability may use Node diagnostics channels in
  modern Node
- arbitrary raw `process.stdout.write(...)` observation still requires
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
| At least one resource exhaustion     | 5         |
| Runner crashed (internal bug)        | 70        |

Test code calling `process.exit(code)` is treated as a runner-level error
and attributed to the currently-running test. The default policy is to
**throw** when the test attempts `process.exit` in a profile that disallows
process termination (microtest profile blocks it via the Node permission
model; integration profile may permit it).

A test profile may opt out of capture-on-exit if the SUT genuinely needs to
test process-exit behavior; that test should run in an isolated subprocess
where `process.exit` is observable as the subprocess exit code.

## Environment Variables

`process.env` is shared mutable process state. Direct mutation inside a test
body makes same-process tests order-dependent, especially under concurrent
execution. Overkill should treat ambient environment mutation as invalid in
microtests and controlled in higher-layer profiles.

Default policy:

- tests may read `process.env`
- microtests must not assign to or delete from `process.env`
- integration-style tests that need environment changes should use an
  environment resource or per-worker process configuration
- environment resources must restore previous values when their scope ends

This is intentionally separate from the capability enumeration. Node's
permission model does not govern `process.env`, and Overkill can enforce this
as runtime state policy even before capability-restricted execution exists.

## Zero-Test Runs

A run that collects zero tests is a **failure** by default. This catches
typos in patterns, broken filters, and accidentally-empty test sets.

There is no escape hatch in the current concept. A workflow that may
legitimately have zero matching tests should make that decision before
invoking Overkill rather than teaching the runner to treat an empty
selection as success.

## Unhandled Rejections And Uncaught Exceptions

Async failures are messy. The runner's policy:

- any unhandled rejection or uncaught exception emitted **during** a
  test's `run` (including its async tail until the next test starts) is
  attributed to that test as a **runner error** (see
  [Failure Artifacts](../authoring/failure-artifacts.md))
- any such error after the last test has finished but before the run
  completes is attributed to the run itself
- any such error from the runner's own machinery is a runner crash

Detection uses `process.on('unhandledRejection')` and
`process.on('uncaughtException')` plus a per-test correlation via
`AsyncLocalStorage` (see [Platform-First Implementation Notes](./platform-first-implementation-notes.md)). The
correlation is best-effort: an async leak that escapes the test's logical
window may be attributed to a sibling test. The runner should warn on
detected attribution drift rather than silently mis-blaming a test.

Tests that intend to test rejection paths use the assertion library's
explicit support (`case.assert.rejects(() => promiseReturningCall(), { message: /expected/ })`)
rather than relying on the global hooks.

## Signal Handling And Cancellation

`SIGINT` (Ctrl-C) and `SIGTERM` policy:

- first signal: graceful cancellation. The runner emits an `AbortSignal`
  at the run scope. Each running test sees its `AbortSignal` flip; tests
  are expected to respect it. Reporters flush partial results.
  Resources are disposed in reverse acquisition order.
- second signal within 5 seconds: hard termination. Workers are killed.
  Partial results are flushed if reachable, otherwise the run exits
  with a runner-error result.
- third signal: immediate `process.exit(130)`.

Cancellation propagates via `AbortController` chains, in keeping with
[Platform-First Implementation Notes](./platform-first-implementation-notes.md). Tests that ignore the abort
signal cannot be force-killed in-process; supervised profiles can kill the
worker (see [Microtests And Capabilities § Hang Detection And Forced Termination](../authoring/microtests-and-capabilities.md#hang-detection-and-forced-termination)).

## Process Crash Handling

When a worker process dies mid-test (segfault, OOM, native-addon crash):

- the test that was running is recorded as a runner error with an
  explicit `crash` cause
- tests already enqueued to that worker are reassigned to other workers
- the worker is replaced from the pool
- if crashes exceed a budget (default 3 within a run), the run aborts
  with a runner error to prevent infinite-replay loops

The crash report includes the captured output, the worker's exit signal,
core-dump pointer where available, and the test identity that was active.
This complements [Microtests And Capabilities](../authoring/microtests-and-capabilities.md)'s discussion of crash-
only supervision.

## Resource Budgets

Resource budgets prevent one test from consuming enough memory or runtime
resources to kill the host before the runner can name the culprit. They are
part of runtime policy, not benchmark policy: a benchmark asks "how much did
this workload use?", while a resource budget asks "did this test exceed the
ceiling for this profile?"

Overkill uses Node runtime APIs first. The default implementation should not
shell out to `ps`, read `/proc`, install native addons, or require cgroup
management. Useful built-ins include:

- `node:child_process` for disposable supervised workers
- `process.memoryUsage.rss()` for cheap resident-memory samples
- `process.resourceUsage()` for completion-time resource usage
- `process.constrainedMemory()` to derive defaults from host or container
  constraints when Node can see them
- `process.getActiveResourcesInfo()` for active-resource diagnostics
- `node:v8` heap statistics for JavaScript heap context
- `process.report` and `--report-on-fatalerror` for fatal diagnostic reports
- V8 memory flags such as `--max-old-space-size` for child process heap
  ceilings

### Metrics

First-party resource budgets should start with metrics Node can observe or
influence portably:

- `v8HeapBytes` checked by a child process heap ceiling and telemetry
- `rssBytes` sampled with `process.memoryUsage.rss()` while the worker event
  loop can run
- `residentGrowthBytesPerSecond` derived from consecutive RSS samples
- `activeResourceCount` and `activeResourceTypes` from
  `process.getActiveResourcesInfo()`
- `libuvHandleCount` from diagnostic reports when available

Avoid calling any of these `allocationRate`. With Node APIs alone, Overkill
can measure resident growth and heap pressure, not total allocator churn.

Open file descriptor budgets are Node-first but not universal. In strict
microtests, filesystem writes and most accidental file access are already
blocked by the capability profile. In profiles that allow file access,
Overkill may count file resources it owns or observes through Node handle
diagnostics, but it should not claim a complete cross-platform descriptor
count unless Node exposes one.

### Single-Process Microtests

Default `microtest` execution is single-process and concurrent. It has no
parent process or sidecar that can outlive the test body. Therefore:

- assertion value serialization and diff construction are always bounded
- active test identity is emitted before the body starts
- resource telemetry may be sampled between turns of the event loop
- post-test heap, RSS, and active-resource deltas may be reported in verbose
  or debug output
- resource budgets in this mode are diagnostic unless configured to upgrade
  the execution profile

Single-process microtests do not produce a hard `resource-exhausted` kill
for a CPU-bound loop or a synchronous allocation that prevents the event loop
from reaching the sampler. If the process dies, the last streamed active test
identity is useful evidence, but the runner process may not survive to turn it
into a complete `RunResult`.

When a run requests enforced resource budgets for ordinary microtests,
orchestration should resolve the run to `microtest-supervised` unless the user
explicitly selects diagnostic-only policy. This keeps the default path cheap
while avoiding false guarantees.

### Supervised Execution

`microtest-supervised` and other owned-boundary profiles enforce resource
budgets through disposable child processes:

- the parent assigns one active case to a worker at a time
- the worker sends an `active-case` event before evaluating the body
- the worker streams resource samples while its event loop can run
- the parent records the latest active `CaseId`, file, and display name
- the parent kills the child with `process.kill(pid, 'SIGKILL')` when a
  streamed sample breaches policy
- the parent replaces the worker and records the active case with verdict
  `resource-exhausted`

For JavaScript heap pressure, the worker is also spawned with a V8 heap limit
derived from the budget. This helps catch cases where allocation outruns the
sampler but stays inside the V8 heap. The parent still owns attribution
because it already recorded the active case before the body started.

Node-only enforcement is not a perfect host-level memory sandbox. A native
addon, external-memory allocation, or platform behavior that escapes V8 heap
limits can still outrun in-process telemetry. Overkill should state the
enforcement mode in the failure artifact:

- `v8-heap-limit` for a child process killed or aborted by V8 heap pressure
- `sampled` for a parent decision based on worker telemetry
- `post-test-diagnostic` for single-process or completion-only evidence

### Reporting

A resource budget breach is neither an assertion failure nor a timeout. It is
reported as:

- test verdict `resource-exhausted`
- runner error subtype `resource-exhaustion`
- a `ResourceExhaustion` artifact containing the metric, budget, observed
  value, enforcement mode, sample interval, worker id, and active case

The default human message names the test file, test name, metric, budget,
observed peak, and enforcement mode. Verbose mode reports peak resource usage
per test file even when no budget was exceeded, so growth is visible before it
becomes a ceiling.

## Leaked Promises, Timers, And Handles

Detection:

- on-process: `process._getActiveHandles()` and `_getActiveRequests()`
  snapshot before and after each test (in supported profiles); reported
  as resource-leak diagnostics
- AsyncLocalStorage-instrumented Promise tracking flags Promises whose
  parent test has completed but which are not yet settled
- the diagnostic is a _warning_ by default and a _failure_ in strict
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
| `integration`          | 5 s              | 7 s (worker terminate)                                            |
| `benchmark`            | per-workload     | 1.5 × workload budget, capped at 60 s (single-worker-serial)      |
| `simulation`           | adapter-declared | adapter-declared                                                  |

Rationale for the tight numbers: tests should be categorised
correctly. A microtest that needs more than 500 ms is misclassified;
an integration test that needs more than 5 s is doing real
network I/O it should not be doing. The hard timeouts on supervised
profiles give just enough headroom (~30–40% of soft) for
`AbortSignal`-aware cleanup to actually run before the watchdog kills
the worker.

Override surfaces:

- per-test metadata: `{ timeout: '500ms' }` shortens the soft
  timeout for one test (cannot extend past the profile's hard
  timeout)
- profile configuration overrides set the soft and hard defaults for the
  whole run

Soft-timeout mechanics:

- the test receives an `AbortSignal` linked to the run scope plus a
  per-test deadline; firing the signal is the runner's first
  cancellation step
- a test body that does not respect the signal continues running
  until the hard timeout fires (when available) or the worker is
  abandoned at run completion
- a test that exceeds the soft deadline is a **test failure**, not a
  runner error: the outcome is `fail` with a synthetic `FailedCheck`
  summarising `"exceeded soft timeout <deadline>"`. CI gates
  uniformly on test failures (exit code 1). The runner is never the
  culprit for a slow test — using a slow endpoint or doing extensive
  I/O in a profile that should not is a test-author error.

Hard-timeout mechanics:

- only available in profiles that own a worker or subprocess
  boundary (supervised microtests, integration runs with workers,
  benchmark, simulation)
- the watchdog terminates the worker after the hard timeout; the
  test is recorded as `crashed`
- crash-budget rules (`Process Crash Handling`) apply

In-process modes intentionally lack hard termination — see
[Microtests And Capabilities § Hang Detection And Forced Termination](../authoring/microtests-and-capabilities.md#hang-detection-and-forced-termination) for the rationale and supervised-profile alternative.

## Test Debug Mode

Debug mode is the opt-in switch that keeps per-test diagnostic data
(timeline, handle events, module loads, heap snapshots, active-handle
deltas) and emits it as a structured artifact regardless of outcome.
Activation is always explicit (`--debug`, `--debug-scope`, or per-test
metadata) and never affects the verdict.

The full spec — activation, `TestDebugArtifact` shape, storage,
reporter interaction, overhead, retry/replay behavior, and the
interpretation patterns the artifact surfaces — lives in
[Test Debug Mode](../authoring/debug-mode.md).

## Parallelism Semantics

Parallelism happens at multiple grains. The default for `@overkill-dev/test`
is **concurrent-in-process with seeded randomized scheduling**. Other
modes remain available when the suite or resource model calls for them:

In the unconstrained microtest path, this is conceptually a
`Promise.all(...)`-style launch of the selected cases inside one process
after the seeded plan order has been fixed. The ordering still matters for
plan identity, derived seeds, and any scheduler decisions that must stage
work before resource constraints narrow the runnable set.

| Mode                    | Description                                           | When useful                                         |
| ----------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| `serial`                | One test at a time, single process                    | deterministic simulation, debugger-focused runs     |
| `concurrent-in-process` | Multiple tests' async work interleaves in one process | default for microtests                              |
| `worker-pool`           | N worker threads, file-level distribution             | CPU-bound suites, big monorepos                     |
| `process-per-file`      | Subprocess per test file                              | strong isolation, capability resets, native crashes |
| `single-worker-serial`  | Single worker thread, no concurrency                  | benchmarks, deterministic-simulation                |

Rationale for the default:

- microtests should surface accidental coupling early; a concurrent
  default is better at exposing hidden dependence on ambient global state,
  fake timers, console ordering assumptions, and resource ownership leaks
- same-process concurrency preserves the low cold-start budget while still
  allowing unrelated async work to overlap
- strict serialization remains useful, but it is a debugging and
  determinism tool rather than the default shape for the suite
- tests that genuinely require serialization should declare it through
  resources or run under `--mode serial`, rather than relying on an
  implicitly serialized suite

Selection rules:

- the runner profile names a default mode
- resource execution requirements ([Higher Test Layers § Resource Factories](../authoring/higher-test-layers.md#1-resource-factories-as-the-main-higher-layer-primitive)) can
  upgrade the mode (e.g. exclusive resource forces serialization within
  its scope)
- `--mode` overrides at the CLI

## Execution Order

Execution order is a scheduling concern, not a property of source-file
layout. The default scheduler is **seeded random order**:

- after collection, metadata propagation, filtering, and sharding, the
  selected case set is shuffled by a recorded seed
- if the user does not pass `--seed <value>`, the runner chooses one,
  prints it, and writes it into `RunFacts` and the final `RunRecord`
- rerunning with the same seed and the same filtered case set reproduces
  the same order
- resources or execution constraints may force local serialization, but
  they do not silently disable seeded ordering for unrelated tests

Why randomize by default:

- fixed lexical order hides order-dependent tests for too long
- a seed gives reproducibility without giving up the ability to shake out
  unwanted coupling
- the randomization happens at plan time, so IDEs, replay, and failure
  artifacts can all report the exact realized order

Override surfaces:

- `--seed <value>` selects a specific shuffle
- `--order lexical` disables shuffling and uses deterministic collection
  order
- runner profiles may choose stricter scheduling only where the test
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

Baseline CI mode should not assume that the CI system provides a native
"collect once, distribute exact test plan" primitive. Instead, each shard
performs deterministic self-planning:

- every shard imports and collects the same candidate test set
- every shard applies the same filters, seed handling, ordering, and
  planning rules
- every shard executes only its own partition from `--shard <i>/<n>`

This works with ordinary matrix/parallel-job features in systems such as
GitHub Actions, GitLab, CircleCI, and Buildkite because it only requires
shard identity, not a CI-native planner.

Result collection then happens in two layers:

- **baseline shard mode**
  - each shard is one independent Overkill run
  - each shard produces its own exit code and local reports/artifacts
  - any failing shard fails its CI job, so the overall workflow fails
- **optional merged-results mode**
  - each shard emits a machine-readable result artifact
  - a later merge step combines those artifacts into one final report
    and one overall run result

The merged overall result should be:

- `pass` only if all shards pass
- `fail` if any shard reports test failures
- `error` / `inconclusive` if any shard crashes, is missing, or fails to
  report a usable result

CI integration: GitHub Actions, GitLab, CircleCI, and similar matrix systems
map directly to `--shard`. Richer workflows may additionally run an explicit
merge step such as `overkill merge-results ...` to produce one combined
JSON/HTML report.

## Multi-Process Execution

Multi-process execution does **not** change how tests are discovered.
Collection still happens once in the orchestrator:

- test files are imported in the planning process
- the full `TestNode` tree is collected
- metadata resolution, filtering, sharding, and ordering happen there
- the resulting `RunFacts` and executable `TestPlan` are frozen before
  any worker executes a test

Only after that does the runner hand work to workers or subprocesses.

This has two important consequences:

- workers never "register more tests later"
- sharding is over the collected logical case set, not over whatever a
  worker happens to discover locally

Assignment depends on execution strategy:

- `concurrent-in-process`
  - one process owns the whole frozen plan
  - cases launch inside that process subject to resource constraints
- `worker-pool`
  - the orchestrator assigns plan items to N workers
  - assignment may still group by file when that keeps imports cheaper or
    respects runtime-sharing boundaries
- `process-per-file`
  - the orchestrator groups the frozen case set by source file
  - each subprocess imports exactly the file(s) it was assigned and
    executes only the planned subset from that file
- `single-worker-serial`
  - one dedicated worker/process executes the whole frozen plan in order

The worker input is therefore not "go discover tests." It is:

- the frozen run identity (`runId`, seed, selected shard, ordering)
- assigned case identities
- runtime / capability / timeout requirements
- reporter and artifact routing metadata

Workers re-import code to obtain executable test-body references, but that
re-import is execution-time plumbing, not a second discovery authority.

## Remote Execution

Remote execution is not a default mode, but the concept should still define
its shape.

The core rule is the same as for local multi-process runs:

- collection happens once in the coordinator
- the coordinator freezes `RunFacts`
- remote workers execute assigned plan items; they do not recollect or
  mutate the plan

Minimal remote-execution sketch:

1. The coordinator resolves the full plan locally.
2. The plan is partitioned into remote work units.
3. Each work unit contains:
   - case identities
   - ordering / seed data
   - required runtime adapters and capability envelope
   - artifact upload policy
4. A remote worker checks that it can satisfy the requested environment.
5. The worker imports the assigned test code, executes only the assigned
   plan items, and streams structured events/results back.
6. The coordinator merges remote results into the same final `RunRecord`
   shape used for local runs.

The important architectural consequences are:

- remote execution belongs above `@overkill-dev/engine`, in orchestration /
  coordinator packages
- stable `CaseId`, serializable `RunFacts`, and structured events are what
  make remote work possible; terminal output alone is not enough
- artifact identity cannot depend on which machine executed the case
- capability and runtime requirements must be declarative enough for a
  coordinator to decide placement before execution starts

Remote execution should therefore be thought of as "another executor behind
the same frozen-plan protocol," not as a separate discovery model.

## Terminal Capability Detection

Moved to [CLI Reference § Terminal Capability Detection](../reference/cli.md#terminal-capability-detection) — those rules
(color, animation, progress UI, terminal width) are CLI- and
reporter-scoped, not runtime concerns.

## Configuration Layering

How project policy composes across a monorepo (root configuration,
package-level extension, the `--config` flag, and the boundary
against ordinary CLI selection flags) is documented in
[Configuration § Configuration Layering](./configuration.md#configuration-layering).

## Watch-Mode Targeting

Watch mode should stay simple by default and lean on Node `--watch`.

Default behavior:

- a watched rerun reruns the selected suite again
- no custom module-graph logic is assumed in the default concept

If Overkill later adds smarter related-test reruns, that should be treated as
an optional enhancement rather than the baseline promise.

## Source Maps In Failure Stacks

With Node's built-in type stripping, ordinary TypeScript source locations
should already be good enough in the common path. Overkill should not assume a
custom source-map story unless a specific transform path requires it.

Assertion source locations are captured from Node-rendered stack text through
a lazy non-thrown `Error` token. When Node strips TypeScript types, line and
column numbers stay aligned because stripping preserves whitespace. When
`--enable-source-maps` is active, Node maps rendered stack frames before
Overkill parses them. Overkill does not install `Error.prepareStackTrace`,
depend on V8 `CallSite` objects, or resolve source maps itself in the
baseline engine.

## Encoding And Locale

The runner forces `LC_ALL=C.UTF-8`-equivalent behavior internally for
deterministic sort and number formatting in reports. User code is not
affected. Test output is captured as bytes; rendering decodes as UTF-8.

## Network And Filesystem Defaults

By profile ([Microtests And Capabilities](../authoring/microtests-and-capabilities.md) enumerates):

- microtest: deny FS write, deny net, deny child process, deny worker
- integration: allow FS write within a per-test temporary directory, allow
  loopback net, allow child process
- benchmark: allow as integration but with single-worker
  serialization

The temporary-directory convention is `os.tmpdir() + /overkill-<run-id>/<test-id>/`,
created lazily per test, removed on test completion (or run completion in
debug mode). This is one of the runner-owned escape hatches named in
[Microtests And Capabilities](../authoring/microtests-and-capabilities.md).

## Cross-References

This document is the runtime counterpart to several others. Cross-links:

- [Microtests And Capabilities](../authoring/microtests-and-capabilities.md) — capability profiles, hang
  detection, supervision
- [Failure Artifacts](../authoring/failure-artifacts.md) — output capture, runner-error vs test-failure
  distinction
- [Metadata And Selection](./metadata-and-selection.md) — selection rules sharding composes with
- [Fast Feedback Loops](./fast-feedback-loops.md) — watch mode and cache behavior
- [Platform-First Implementation Notes](./platform-first-implementation-notes.md) — `AbortSignal`, source maps,
  `AsyncLocalStorage`
- [Package Architecture](./package-architecture.md) — execution strategy decisions live in
  `@overkill-dev/run`; this doc names the resulting runtime defaults

## Resolved Edge Policies

- unhandled async errors are attributed to the originating test when the
  runner can correlate them through owned task or async-resource context;
  otherwise they are run-level runner errors labeled as unattributed async
  leaks. The runner should not guess and blame a sibling test by timing
  alone.
- strict microtest profiles elevate leaked resources to failures by
  default. Integration and benchmark-oriented profiles report leaks as
  runner diagnostics by default, with policy able to escalate them.
- monorepo cross-package fixture sharing is only valid through explicit
  run-scope or shared resource definitions. It is never inferred from
  package layout or discovery.
- sharding for dynamic test generation works by collecting once, freezing
  the resolved identities, and partitioning that collected set. Overkill
  should not independently recollect dynamic test trees on each shard and
  hope they match.
