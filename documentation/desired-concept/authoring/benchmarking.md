# Benchmarking

## Position

Benchmarking is a first-class Overkill package family, not a side mode of the
ordinary test runner.

The core reason is that benchmark suites need a richer model:

- controlled workloads
- lifecycle management
- domain metrics
- calibration
- budgets

The benchmark family should stay focused on **performance and
resource-consumption** questions.

That includes:

- runtime
- throughput
- latency percentiles
- responsiveness / jank
- memory and resource usage
- startup and cold-load cost
- bundle-size and artifact-size budgets

It does **not** mean "any numeric scoring problem." For example:

- model accuracy benchmarks
- business KPI scoreboards
- quality or relevance leaderboards

are outside the intended first-party benchmark scope unless they are clearly
framed as performance/resource benchmarks.

## Benchmark Design Consequences

Practical benchmark suites show that many important benchmark needs are not
"microbench library" problems at all.

The concept needs to support:

- **cold-start benchmarking** as a first-class shape, not only hot loops
- **memory budgets** alongside time budgets
- **real workflow benchmarking** rather than just function timing
- **checked-in budgets** that are reviewable and enforced in CI
- **machine normalization** as an explicit concept
- **fresh import / cold module state** helpers as part of the harness
- **named workload files**
- **checked-in threshold files**
- **benchmark-specific metric schemas**
- **real local service lifecycle**
- **CLI responsiveness as a first-class benchmark kind**
- **secondary metrics that are not reducible to one median runtime**

This also implies a few non-goals for an ad hoc benchmark helper:

- median-only reporting is not enough
- project-local normalization logic should become a harness concern
- startup and runtime benchmarks should not have to masquerade as ordinary
  tests
- memory should not be limited to one simplistic RSS delta metric
- benchmark-specific reporting and artifact output should exist

That is strong evidence for Overkill's direction: benchmark suites need a
dedicated package family, not just "tests with a timer."

`@overkill-dev/bench` is included in the standard `@overkill-dev/test`
distribution so teams get benchmark support from the normal install. It must
still stay outside the root `@overkill-dev/test` import graph and ordinary
single-process microtest startup path.

Benchmarks use a dedicated CLI namespace:

```text
overkill bench run
overkill bench list
overkill bench baseline update
```

`overkill run --profile benchmark` is rejected. This keeps one first-party
benchmark execution path and avoids making benchmarks look like ordinary tests
with a different profile.

Benchmark suites still need named configuration. They use a separate
`benchmark.profiles` namespace:

```ts
export const config = defineConfig({
    benchmark: {
        profiles: {
            'cli-cold-start': {
                files: {
                    include: [ 'source/**/*.bench.ts' ],
                    exclude: []
                }
            }
        }
    }
});
```

This lets `overkill bench run --profile cli-cold-start` select benchmark
configuration without making `benchmark` an ordinary `overkill run` profile.

It also confirms that Overkill should support:

- benchmark registries or service handles as resources
- PTY-aware process benchmarking
- explicit metric-specific budgets
- normalization as a first-class harness concern
- benchmark-specific artifact output and diagnostics

The benchmark-specific reporter offering should be considered settled too:

- generic reporters may still render benchmark pass/fail and summary data
- but Overkill should also ship a dedicated
  `@overkill-dev/reporter-benchmark-html` package for benchmark-oriented final
  reports

That reporter should present:

- workload/group tables
- raw and normalized metrics
- percentiles and configured summary statistics
- budget/baseline deltas
- machine/runtime comparability metadata
- visual comparison output such as distribution or workload plots

It should be a separate reporter package rather than part of
`@overkill-dev/bench`, because the benchmark package owns benchmark execution and
result semantics while reporter packages own presentation.

## Benchmark Definition Model

The conceptual unit should be a **workload-oriented benchmark**, not just “function X.”

A benchmark definition should be able to describe:

- named workload dimensions such as small, medium, large
- deterministic fixture generation
- validation of generated fixtures
- resource and runtime requirements
- fixture lifecycle through ordinary resource/runtime descriptors
- warmup rules
- measurement strategy
- pre-measurement fixture preparation that is excluded from timing
- benchmark-specific cleanup that runs between or after samples
- benchmark kind metadata such as `throughput`, `responsiveness`,
  `startup`, `bundle-size`, or `browser-performance`

This is closer to BenchmarkTools benchmark groups and to real workflow benchmarking than to a simple timing loop.

Example direction:

```ts
import { benchmark, suite, workload } from '@overkill-dev/bench';
import { withResource } from '@overkill-dev/test/resources';
import { publishFixtureResource } from '#tests/resources/publish-fixture';

export const testNode = suite('cli benchmarks', [
    benchmark('publish command', {
        kind: 'responsiveness',
        workloads: [
            workload('small', { packages: 5 }),
            workload('medium', { packages: 50 }),
            workload('large', { packages: 200 })
        ],
        measure: withResource(publishFixtureResource, async (context) => {
            const { resources, sample } = context;
            const run = await sample.process({
                command: [ 'node', 'dist/cli.js', 'publish', '--dry-run' ],
                cwd: resources.publishFixture.cwd,
                pty: true
            });

            return {
                durationMilliseconds: run.durationMilliseconds,
                startupMilliseconds: run.startupMilliseconds,
                percentile95EventLoopBlockMilliseconds: run.eventLoop.percentile95Milliseconds,
                maximumEventLoopBlockMilliseconds: run.eventLoop.maximumMilliseconds,
                outputBytes: run.stdoutBytes + run.stderrBytes
            };
        }),
        diagnosticMetrics: [ 'outputBytes' ],
        budgets: {
            small: {
                durationMilliseconds: { maximum: 500 },
                startupMilliseconds: { maximum: 120 },
                percentile95EventLoopBlockMilliseconds: { maximum: 8 },
                maximumEventLoopBlockMilliseconds: { maximum: 20 }
            },
            medium: {
                durationMilliseconds: { maximum: 900 },
                startupMilliseconds: { maximum: 150 },
                percentile95EventLoopBlockMilliseconds: { maximum: 16 },
                maximumEventLoopBlockMilliseconds: { maximum: 30 }
            },
            large: {
                durationMilliseconds: { maximum: 3200 },
                startupMilliseconds: { maximum: 220 },
                percentile95EventLoopBlockMilliseconds: { maximum: 24 },
                maximumEventLoopBlockMilliseconds: { maximum: 40 }
            }
        }
    })
]);
```

The important shape in this example:

- workload size is explicit and named
- fixture lifecycle is expressed through existing resource/runtime descriptors,
  not benchmark-local hooks
- the measured action is a real external CLI workflow, not a naked function
- multiple metrics are recorded from one run
- the exported value is the conventional `testNode`
- the benchmark family still composes with ordinary `suite(...)` values
- the returned object contains measured metrics only
- every returned metric is either covered by `budgets` or listed in
  `diagnosticMetrics`
- budgets are checked in as reviewable data instead of buried in ad hoc
  assertions inside `measure(...)`

`measure(...)` may return either a metric object or a promise for a metric
object. Synchronous `measure(...)` bodies are important for microbenchmarks
because the harness should not add a `Promise.resolve(...)` boundary when the
workload itself is synchronous.

Budget evaluation happens after samples are measured and aggregated. Internally,
benchmark budget checks should be represented with the same assertion protocol
used by ordinary tests, so reporters can reuse structured assertion failure
rendering. They are generated harness assertions, not user-authored assertions
inside the measurement window. They do not count toward user `plan(n)` calls,
do not satisfy ordinary no-assertion detection before measurement, and do not
let measurement code branch on pass/fail logic.

Budget coverage is strict:

- a benchmark must define at least one budget
- a returned metric with no matching budget and no `diagnosticMetrics` entry is
  a definition error
- a budget for a metric that is not returned by `measure(...)` is a benchmark
  failure
- diagnostic metrics are reported and stored, but they never decide pass/fail

Benchmark authoring should not introduce a parallel hook model. In particular,
`@overkill-dev/bench` should not add benchmark-specific `setup(...)`,
`teardown(...)`, `beforeEach(...)`, or `afterEach(...)` hooks. Work that must
happen outside the measured region belongs in existing resources, runtimes,
fixture resources, or sample cleanup/cooldown phases owned by the benchmark
harness. That keeps benchmark suites aligned with the rest of Overkill:
collection sees descriptors before scheduling, planning can lower them into
placement constraints, and execution can acquire and dispose handles through
the ordinary resource/runtime lifecycle.

Benchmark-specific fixture resources may be workload-aware when the workload is
part of planning. For example, a package-registry fixture or temporary project
fixture can be acquired for a named workload before measured samples begin, and
the benchmark body can read the injected handle through `context.resources` or
`context.runtimes`. Any per-sample reset that must occur between measurements
belongs to benchmark cleanup, not to a user-authored lifecycle hook hidden
inside `measure(...)`.

Settled decisions:

- benchmark authoring is a facade over ordinary Overkill test-node authoring
  and generated assertions, not a separate runner universe
- `overkill bench run` remains the public command namespace, but it resolves
  through the regular runner planning, placement, execution, result, and
  reporter flow
- `budgets` is the public gate field; `policy`, `assertions`, `slo(...)`, and
  `budget(...)` are not settled benchmark authoring APIs
- custom sample metrics come from the `measure(...)` return object; no
  `context.record(...)` or `context.recordMetric(...)` API is part of the
  current concept
- `diagnosticMetrics` marks returned metrics that should be reported but never
  gate pass/fail
- benchmark definitions must have at least one budget, so every committed
  benchmark produces real generated assertions
- resource/runtime descriptors carry lifecycle, fixture, service, browser,
  registry, temporary-directory, and PTY needs into planning
- host calibration discovers host capacity and noise before measured samples;
  it does not infer arbitrary per-case workload cost
- parallel benchmark placement is allowed only when the measurement strategy
  and host calibration agree it is safe
- ambient-noise handling always records metadata where available, may block on
  opt-in thresholds, and may reduce lanes or switch to serial placement
- `hostProcess` is a resolved execution shape for worker-pool runs that need
  process-level Node or V8 flags, profiling, debugging, or benchmark isolation
- forced V8 garbage collection is opt-in; supervised or hosted benchmark
  processes may enable `--expose-gc`, but the harness calls
  `globalThis.gc()` only when requested

Source:

- <https://juliaci.github.io/BenchmarkTools.jl/stable/manual/>

## Measurement Layer

The measurement layer should support:

- runtime and throughput
- memory and allocation-oriented measurements where available
- percentiles
- event timelines
- custom secondary metrics per sample
- browser-facing performance metrics where a browser runtime exposes them
- artifact-size measurements for bundle and output budgets

It should also leave room for multiple measurement strategies and metric
collectors:

- simple wall-clock timing
- CPU time
- user time and system time where the platform exposes them
- memory, allocation, heap, and resident-set measurements
- event-loop and runtime-health measurements
- I/O or handle-count measurements where they are observable
- custom counters
- external diagnosers
- process-level measurements for external command benchmarks

Tinybench is a useful reference for statistics APIs and event hooks, but it
only solves part of the problem.

Node's `node:bench` is also useful design input, especially its explicit
runner, warmup and sample events, fresh-process CLI mode, and warnings about
noise, optimization, and comparability. It is not a foundation for
`@overkill-dev/bench`: it is early-development Node API surface, requires
`--experimental-bench`, owns a runner model that overlaps with Overkill, and
does not provide the benchmark budget, calibration, placement, or artifact
model Overkill needs.

Source:

- <https://github.com/tinylibs/tinybench>
- <https://raw.githubusercontent.com/nodejs/node/main/doc/api/bench.md>

## Budget Layer

Overkill should separate measurement from budgets.

Budget examples:

- median must remain below a checked-in budget
- p50/p95/p99 must stay within explicit bounds
- p99 latency may regress only within tolerance
- responsiveness metrics must remain within a calibrated range
- results may be normalized relative to a calibration workload
- cold-start and steady-state benchmarks may use different budgets
- bundle output must stay below a checked-in size budget
- browser paint / interactivity metrics must stay within explicit limits

This budget layer is where CI gating semantics belong. Reporters explain the
outcome; budgets decide what counts as failure. The budget layer is still built
on Overkill's assertion protocol internally, so benchmark failures remain
ordinary structured failures to reporters and machine consumers.

## Latency-Sensitive Budgets

Latency-sensitive testing belongs inside the benchmark family rather than
beside it as a separate testing model.

The settled direction is:

- measurement captures latency, responsiveness, and related metrics
- budgets evaluate those measurements against explicit service-level or
  workflow-level budgets
- the same benchmark/reporting infrastructure carries the result

Typical examples:

- p50/p95/p99 latency ceilings
- event-loop stall budgets
- interaction latency or jank budgets in browser-facing workloads
- startup responsiveness budgets for CLIs or services

So the distinction should stay clear:

- benchmarks measure behavior
- budgets decide whether measured behavior stays within declared
  latency/service budgets

## Execution Strategy

Benchmarks should be allowed to influence execution strategy strongly, because measurement reliability is often more important than raw throughput.

Typical benchmark preferences may include:

- forcing worker count to `1`
- preventing unrelated workloads from running concurrently
- isolating process state between workloads
- reusing expensive resource/runtime state only where it does not contaminate
  measurements
- forking fresh processes for cold-start benchmarks
- preserving one warmed process for steady-state measurement
- launching a browser with a controlled runtime profile
- isolating browser benchmark runs from unrelated system noise where
  possible
- using a host process when custom Node or V8 flags are needed
- reducing or disabling benchmark parallelism when the measurement strategy or
  host calibration says parallel execution would contaminate results

Overkill should therefore distinguish benchmark shapes such as:

- cold-start
- steady-state
- external-process
- throughput-oriented
- latency-oriented
- browser-performance
- bundle-size

These should be modeled as execution constraints contributed to orchestration, not as ad hoc benchmark-only hacks.

Benchmark commands should be implemented on top of the regular runner
pipeline. `overkill bench run` remains the public command because benchmark
configuration, baselines, and reports are distinct enough to deserve their own
namespace. Under that command, benchmark authoring compiles to ordinary
Overkill test nodes plus benchmark metadata, then the runner resolves the same
kind of plan, placement, execution, result, and reporter flow used by other
families.

The runner may resolve a hosted worker-pool execution shape when a benchmark or
profile needs process-level control around worker threads. The public
`processModel` can still be `worker-pool`; the extra host process is resolved
execution detail. This is useful beyond benchmarks too, for example when a run
needs profiling or debugging flags. Benchmark execution may use it to pass
`--expose-gc` or other Node/V8 options without requiring the parent runner
process to carry those options.

Parallel benchmark execution is allowed only when safe. The benchmark strategy
contributes an initial capacity shape, such as single-core CPU work,
multi-core wall-clock work, external-process work, or I/O-oriented work. A host
calibration pass then records available parallelism, load, memory pressure,
runtime metadata, and platform-specific noise signals. If the strategy and
calibration agree that independent benchmark cases can run without material
contamination, the runner may use multiple lanes. Otherwise it runs serially or
with reduced lanes and records that placement decision in benchmark metadata.

Noise handling has three levels:

- every benchmark run records noise metadata when available
- profiles may opt into blocking thresholds for known-bad host conditions
- high-noise calibration may automatically reduce benchmark parallelism or
  switch to serial placement before measured samples begin

Node APIs are the first source for portable noise and resource metadata, such
as `os.availableParallelism()`, `os.loadavg()`, `os.freemem()`,
`process.cpuUsage()`, `process.resourceUsage()`, and process memory APIs.
Platform probes such as POSIX or Darwin tools may add detail when they are
available, but their source and unavailable state must be recorded explicitly
so reports do not pretend every host supplied the same data.

Warmup, calibration, cleanup, and cooldown are distinct phases:

- warmup prepares the measured code path and records warmup observations
- host calibration estimates current host capacity and noise before placement
  and measured samples
- cleanup resets benchmark-owned state between samples where needed
- cooldown waits for configured runtime or platform signals to settle, with
  hard caps to avoid hiding hangs

Forced V8 garbage collection is opt-in. Benchmark profiles that run under a
supervised or hosted process may start Node with `--expose-gc`, but the harness
only calls `globalThis.gc()` when the benchmark or profile explicitly requests
forced garbage collection as part of sample cleanup or cooldown.

## Calibration And Normalization

Some benchmark suites need hardware normalization. The concept should therefore include:

- calibration workloads
- scaling rules
- explicit reporting of raw and normalized numbers
- reviewable checked-in budget metadata
- recorded machine metadata
- explicit distinction between comparable and non-comparable runs

The ESLint benchmark suite's `cpuSpeed` factor is a minimal version of this
idea. Overkill should turn that from a hand-written local trick into a
first-class benchmark-harness concept.

## External Process Benchmarking

Benchmarking external processes should be first-class:

- process spawning
- cwd isolation
- environment control
- stdout and stderr capture
- PTY-aware execution for CLI workflows
- prepare and cleanup commands that are not part of the timing window
- command-parameter scans and workload matrices
- repeated fresh-process execution for cold-start measurements

This is critical for real tool benchmarking and should not require ad hoc custom harnesses.

## Event Loop And Runtime Health

Some performance metrics describe the health of the runtime itself rather than the
throughput or latency of a specific workload. These apply to any JavaScript runtime -
Node servers, workers, and browser pages alike - and should be a first-class metric
family rather than something only the browser layer cares about.

Examples:

- event-loop lag / blocking duration
- GC pause counts and durations
- heap allocation pressure and resident size

These are emitted by the workload runtime (`perf_hooks` in Node, equivalent browser
APIs in a browser page) and recorded as additional metrics on the same benchmark run,
not as a separate benchmark shape.

## Browser And Frontend Performance Benchmarks

Browser-facing performance benchmarks should be considered an important
extension of the benchmark family, not a separate unrelated product.

Examples:

- frame pacing / jank
- FPS-related rendering smoothness
- first paint / first contentful paint style metrics
- interaction responsiveness
- bundle or output size budgets that influence page performance

The implementation direction is:

- a dedicated package above `@overkill-dev/bench`:
  `@overkill-dev/browser-bench`
- driven by Playwright or another browser controller
- with metric collection via browser APIs, WebDriver BiDi where it is
  sufficient, DevTools Protocol surfaces where deeper engine-specific
  metrics are needed, or Lighthouse-style analysis where appropriate

The package split should be:

- `@overkill-dev/bench` owns the generic workload, measurement, budgets,
  baseline, and reporting contracts
- `@overkill-dev/browser-bench` owns browser runtime provisioning, page-flow
  workloads, browser-specific metric collectors, and browser-specific
  artifact capture

Concept sketch for `@overkill-dev/browser-bench`:

- benchmark author declares a browser workload through a helper such as
  `browserBenchmark(...)`
- that workload may represent cold page load, route transition, typed
  interaction flow, or repeated render/update loop
- the package provisions a controlled browser runtime and page/session
  lifecycle around that workload
- metrics may come from portable browser surfaces first, with deeper
  engine-specific adapters layered where needed
- artifacts may include traces, screenshots, filmstrips, performance-event
  timelines, and raw metric dumps attached to the benchmark result
- budgets remain expressed through the shared benchmark model: explicit
  budgets for paint timing, interaction latency, jank, bundle weight, or
  other measured dimensions

This keeps browser benchmarking inside one benchmark family while still
giving it a real package boundary and room for browser-specific mechanics.

The benchmark layer should therefore be **backend-agnostic** at the concept
level:

- BiDi-first where portable browser automation and event streams are enough
- CDP where richer Chromium-specific performance metrics or tracing are
  required
- Lighthouse-style adapters where page-flow auditing is the better fit

The important conceptual point is that these are still **performance and
resource-consumption** benchmarks. They belong in the benchmark family.

Relevant platform/tooling influences:

- WebDriver BiDi
- Chrome DevTools Protocol performance metrics
- Chrome DevTools performance analysis workflows
- Lighthouse user-flow / timespan style page-performance measurement

Sources:

- <https://www.w3.org/TR/webdriver-bidi/>
- <https://chromedevtools.github.io/devtools-protocol/tot/Performance/>
- <https://developer.chrome.com/docs/devtools/performance/overview>

## Baselines

Performance baselines are snapshot-like in workflow but stricter in meaning.

Useful stored data may include:

- machine metadata
- workload identity
- median and percentile thresholds
- calibration context
- exact metadata expectations
- range-based budget semantics
- benchmark shape (`cold-start`, `steady-state`, `external-process`, etc.)
- measurement strategy identity
- browser/runtime metadata for frontend benchmarks
- bundle-size budget metadata

## Reporting

Benchmark reports should be:

- readable in CI
- machine-readable for automation
- specific about the failing benchmark, workload, metric, and threshold
- explicit about whether results are raw, normalized, or not comparable
- clear about warmup, sample count, and process model

## Adopted Concepts

Overkill is deliberately borrowing selected benchmark concepts rather than
copying one existing benchmark ecosystem wholesale.

The benchmark model described here adopts ideas such as:

- grouped and parameterized workloads
- warmup / measurement phase separation
- explicit execution profiles for different benchmark shapes
- diagnoser-style secondary metrics beyond wall-clock runtime
- machine-readable benchmark results with machine metadata
- first-class external-process benchmarking

The attribution-heavy source list lives in [Research Landscape § Influences](../research/research-landscape.md#influences). This document
keeps only the product-level concepts that materially shape the benchmark
family.

Overkill should not copy all of these tools, but it should absorb their best
ideas into one coherent benchmark model.

## Influences

JMH provides the strongest reminder that a benchmark harness must actively help users avoid misleading results.

## Sources

- <https://github.com/openjdk/jmh>
