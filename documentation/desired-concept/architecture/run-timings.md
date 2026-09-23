# Run Timings

## Purpose

Overkill records runner timings so users can see where a run spent time without
turning every investigation into a benchmark or a per-test debug session.

The timing model answers three different questions:

- how long did the whole run take?
- how much of that time was test execution versus runner overhead?
- when precise timings are requested, which runner phase, process boundary,
  worker, or resource lifecycle consumed the overhead?

Timings are diagnostic data. They never affect test verdicts, timeout policy,
resource budget policy, or benchmark pass/fail decisions.

## Summary Timings

Every completed run includes a small stable timing summary in `RunResult`.
The summary is always collected because it is cheap and useful in ordinary
human output, IDEs, and automation.

The default summary contains:

- total wall time
- test execution wall time
- runner overhead wall time

`testExecutionWallTime` is the elapsed window from the first selected test
start to the last selected test end. It is not the sum of per-test durations.
Concurrent tests can overlap, and the summary should stay intuitive:
`total - execution = overhead`.

`runnerOverheadWallTime` covers observable orchestration time outside that
execution window. It includes work such as config loading, discovery,
collection, planning, worker/process setup, resource lifecycle work that
precedes or follows execution, reporter setup, reporter finish, and cleanup.

The summary uses microsecond integer durations. Human reporters may render
milliseconds, but the structured model should not use floating point values
for core timing facts.

Overkill owns its timing clock abstraction. Durations and diagnostic offsets
come from a monotonic microsecond clock. Wall-clock metadata, such as the ISO
run-start timestamp shown to users, remains available through the same
platform boundary but is not used for duration math.

## Precise Timings

Precise timing collection adds bounded spans and aggregate buckets to the run
result. It is enabled by:

- `overkill run --timings`
- `RunRequest.timingCollection: 'precise'`
- profile configuration `timings.collection: 'precise'`
- an execution strategy that requires precise timing facts

Execution strategies may require precise timings for scheduling, placement, or
history inputs. When precise timings are collected for any reason, timing-aware
human reporters should show a compact summary plus the slowest overhead
offenders. Full detail belongs in structured reporter data.

Precise timing spans use a closed first-party taxonomy. Free-form span names
are not part of the canonical timing report because reporters, history
comparison, and issue triage need stable names. If extension spans are added
later, they should use a separate namespaced extension mechanism.

## Phase Coverage

Precise runner timings should cover resolve-time and execution-time phases.
The first implementation does not need every phase on day one, but the concept
expects one model for all of them.

Resolve-time phases:

- command parsing and config path resolution
- config loading and validation
- profile and reporter resolution
- file discovery
- collection
- coarse test-file import windows
- test data propagation
- runtime and workload expansion
- filtering
- work-unit construction
- sharding
- seeded or lexical ordering
- resource lowering
- placement planning
- resolution freeze

Execution-time phases:

- reporter delivery and finish callbacks
- in-process execution window
- supervised process spawn, ready, execution, teardown, and exit
- worker-pool start, ready, shutdown, and cleanup
- individual worker create, ready, coarse import startup, work assignment,
  teardown, and exit
- resource acquire and dispose
- retry, cancellation, crash recovery, reassignment, and cleanup phases where
  those features apply

Random ordering and other small planning steps are still timing phases. They
are often cheap, but measuring them makes a slow sort, unstable seed path, or
bad identity construction visible.

## Import Timing

Runner timings record coarse import windows:

- host entry startup
- child or worker entry startup
- collection import per test file or assigned file group
- execution re-import per test file or assigned work unit

Per-module import timing is a debug-mode concern because it usually needs
loader hooks or module-load instrumentation that can distort the hot path. Test
debug artifacts may include module-load detail for selected cases; runner
timings stay coarse and orchestration-oriented.

## Cross-Process Clock Model

The parent process owns the canonical orchestration timeline.

Child processes and workers report local durations, not globally comparable
absolute timestamps. Useful child and worker facts include:

- entry loaded to ready message
- ready message to first assigned work
- assigned work import duration
- assigned work execution duration
- teardown start to exit

The parent can measure parent-observed spans such as spawn call to ready
message, shutdown request to exit, and worker-pool start to ready. The concept
does not pretend that different processes share one monotonic nanosecond
clock.

## Resource Lifecycle Timings

Precise timings include resource lifecycle spans for every acquired resource.
Each span records:

- resource name
- lifecycle phase, `acquire` or `dispose`
- resource scope
- process or worker identity when applicable
- duration
- status: `success`, `failure`, `cancelled`, or `timeout`

Resource timing spans are emitted even when acquisition or disposal fails.
Slow failed setup and slow cleanup are often the most important timings in an
integration run.

Aggregate resource timing should remain available even if detailed spans are
truncated.

## Bounding And Overhead

Precise timings are bounded. The timing report records:

- the maximum span count
- whether spans were truncated
- how many spans were dropped
- aggregate totals per timing kind
- top overhead offenders retained for human output

Truncation never removes the default timing summary and never removes aggregate
totals.
When detailed spans exceed the retention limit, `spans` keeps the chronological
prefix and `slowestSpans` keeps full copies of the slowest observed offenders
so human reporters do not depend on the chronological retention policy.

Timing collection overhead is reported only for observable work:

- recording overhead the runner can measure directly
- aggregation overhead
- serialization overhead
- reporter rendering overhead for timing output

The report should not claim an exact total cost for every timestamp read. That
would create false precision and perturb the thing being measured.

## Ambient Noise

Ambient noise is a precise timing diagnostic, not part of the stable default
summary.

When implemented, it should be best-effort and explicit:

- `low`
- `medium`
- `high`
- `unknown`

Possible inputs include event-loop delay, sampling jitter, CPU-to-wall-time
ratio, memory pressure, and platform signals Node exposes. The heuristic must
be documented before it appears in default reporter output.

## Reporter And Exporter Surface

Line, brief, and dot reporters show the compact timing summary for ordinary
runs. Timing-aware reporters show top overhead offenders when precise timings
are available. Protocol reporters such as TAP keep their protocol semantics and
may omit human timing decoration.

Machine-readable reporters receive the structured timing report from
`RunResult`.

OpenTelemetry is an export path, not the canonical timing model. The concept
allows an optional `@overkill-dev/reporter-opentelemetry` package that maps
Overkill timing reports to OpenTelemetry spans without making OpenTelemetry a
core dependency or changing the hot path.

## Boundaries With Debug And Benchmarking

Runner timings are not debug mode. Debug mode records per-test timelines,
handle events, module loads, heap data, and active-handle deltas for selected
tests.

Runner timings are not benchmarking. Benchmarking owns measurement-quality
performance work, warmup/sample policy, calibration, and benchmark budgets.
Runner timings explain orchestration overhead for a concrete run.

## Cross-References

- [Runtime Behavior](./runtime-behavior.md) - process models, resource budgets,
  timeouts, worker pools
- [Composition Order](./composition-order.md) - where timing wraps resolve-time
  and execution-time phases
- [Reporters](./reporters.md) - human and machine timing presentation
- [Test Debug Mode](../authoring/debug-mode.md) - per-test debug artifacts and
  module-load detail
- [Benchmarking](../authoring/benchmarking.md) - measurement-quality
  performance workflows
