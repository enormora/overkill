# Benchmarking

## Position

Benchmarking is a first-class Overkill package family, not a side mode of the ordinary test runner.

The core reason is that benchmark suites need a richer model:

-   controlled workloads
-   lifecycle management
-   domain metrics
-   calibration
-   policies and budgets

The benchmark family should stay focused on **performance and
resource-consumption** questions.

That includes:

-   runtime
-   throughput
-   latency percentiles
-   responsiveness / jank
-   memory and resource usage
-   startup and cold-load cost
-   bundle-size and artifact-size budgets

It does **not** mean "any numeric scoring problem." For example:

-   model accuracy benchmarks
-   business KPI scoreboards
-   quality or relevance leaderboards

are outside the intended first-party benchmark scope unless they are clearly
framed as performance/resource benchmarks.

## Benchmark Design Consequences

Practical benchmark suites show that many important benchmark needs are not
"microbench library" problems at all.

The concept needs to support:

-   **cold-start benchmarking** as a first-class shape, not only hot loops
-   **memory budgets** alongside time budgets
-   **real workflow benchmarking** rather than just function timing
-   **checked-in budgets** that are reviewable and enforced in CI
-   **machine normalization** as an explicit concept
-   **fresh import / cold module state** helpers as part of the harness
-   **named workload files**
-   **checked-in threshold files**
-   **benchmark-specific metric schemas**
-   **real local service lifecycle**
-   **CLI responsiveness as a first-class benchmark kind**
-   **secondary metrics that are not reducible to one median runtime**

This also implies a few non-goals for an ad hoc benchmark helper:

-   median-only reporting is not enough
-   project-local normalization logic should become a harness concern
-   startup and runtime benchmarks should not have to masquerade as ordinary
    tests
-   memory should not be limited to one simplistic RSS delta metric
-   benchmark-specific reporting and artifact output should exist

That is strong evidence for Overkill's direction: benchmark suites need a
dedicated package family, not just "tests with a timer."

It also confirms that Overkill should support:

-   benchmark registries or service handles as resources
-   PTY-aware process benchmarking
-   explicit metric-specific policies
-   normalization as a first-class harness concern
-   benchmark-specific artifact output and diagnostics

## Benchmark Definition Model

The conceptual unit should be a **workload-oriented benchmark**, not just “function X.”

A benchmark definition should be able to describe:

-   named workload dimensions such as small, medium, large
-   deterministic fixture generation
-   validation of generated fixtures
-   suite-level setup and teardown
-   case-level setup and teardown
-   warmup policy
-   measurement policy
-   benchmark-specific setup that is excluded from timing
-   benchmark-specific cleanup that runs between or after samples
-   benchmark kind metadata such as `throughput`, `responsiveness`,
    `startup`, `bundle-size`, or `browser-performance`

This is closer to BenchmarkTools benchmark groups and to real workflow benchmarking than to a simple timing loop.

Source:

-   <https://juliaci.github.io/BenchmarkTools.jl/stable/manual/>

## Measurement Layer

The measurement engine should support:

-   runtime and throughput
-   memory and allocation-oriented measurements where available
-   percentiles
-   event timelines
-   custom secondary metrics per sample
-   browser-facing performance metrics where a browser runtime exposes them
-   artifact-size measurements for bundle and output budgets

It should also leave room for multiple measurement backends:

-   simple wall-clock timing
-   custom counters
-   external diagnosers
-   process-level measurements for external command benchmarks

Tinybench is a useful reference for statistics APIs and event hooks, but it only solves part of the problem.

Source:

-   <https://github.com/tinylibs/tinybench>

## Policy Layer

Overkill should separate measurement from policy.

Policy examples:

-   median must remain below a checked-in budget
-   p50/p95/p99 must stay within explicit bounds
-   p99 latency may regress only within tolerance
-   responsiveness metrics must remain within a calibrated range
-   results may be normalized relative to a calibration workload
-   cold-start and steady-state benchmarks may use different policies
-   bundle output must stay below a checked-in size budget
-   browser paint / interactivity metrics must stay within explicit limits

This policy layer is where CI gating semantics belong. Reporters explain the outcome; policy decides what counts as failure.

## Execution Strategy

Benchmarks should be allowed to influence execution strategy strongly, because measurement reliability is often more important than raw throughput.

Typical benchmark preferences may include:

-   forcing worker count to `1`
-   preventing unrelated workloads from running concurrently
-   isolating process state between workloads
-   reusing expensive setup only where it does not contaminate measurements
-   forking fresh processes for cold-start benchmarks
-   preserving one warmed process for steady-state measurement
-   launching a browser with a controlled runtime profile
-   isolating browser benchmark runs from unrelated system noise where
    possible

Overkill should therefore distinguish benchmark shapes such as:

-   cold-start
-   steady-state
-   external-process
-   throughput-oriented
-   latency-oriented
-   browser-performance
-   bundle-size

These should be modeled as execution constraints contributed to orchestration, not as ad hoc benchmark-only hacks.

## Calibration And Normalization

Some benchmark suites need hardware normalization. The concept should therefore include:

-   calibration workloads
-   scaling rules
-   explicit reporting of raw and normalized numbers
-   reviewable checked-in budget metadata
-   recorded machine metadata
-   explicit distinction between comparable and non-comparable runs

The ESLint benchmark suite's `cpuSpeed` factor is a minimal version of this
idea. Overkill should turn that from a hand-written local trick into a
first-class benchmark-harness concept.

## External Process Benchmarking

Benchmarking external processes should be first-class:

-   process spawning
-   cwd isolation
-   environment control
-   stdout and stderr capture
-   PTY-aware execution for CLI workflows
-   prepare/setup/cleanup commands that are not part of the timing window
-   command-parameter scans and workload matrices
-   repeated fresh-process execution for cold-start measurements

This is critical for real tool benchmarking and should not require ad hoc custom harnesses.

## Browser And Frontend Performance Benchmarks

Browser-facing performance benchmarks should be considered an important
extension of the benchmark family, not a separate unrelated product.

Examples:

-   frame pacing / jank
-   FPS-related rendering smoothness
-   first paint / first contentful paint style metrics
-   interaction responsiveness
-   event-loop blocking during UI workflows
-   bundle or output size budgets that influence page performance

The likely implementation direction is:

-   a dedicated package above `@overkill/bench`, likely
    `@overkill/browser-bench`
-   driven by Playwright or another browser controller
-   with metric collection via browser APIs, WebDriver BiDi where it is
    sufficient, DevTools Protocol surfaces where deeper engine-specific
    metrics are needed, or Lighthouse-style analysis where appropriate

The package split should be:

-   `@overkill/bench` owns the generic workload, measurement, policy,
    baseline, and reporting contracts
-   `@overkill/browser-bench` owns browser runtime provisioning, page-flow
    workloads, browser-specific metric collectors, and browser-specific
    artifact capture

Concept sketch for `@overkill/browser-bench`:

-   benchmark author declares a browser workload such as cold page load,
    route transition, typed interaction flow, or repeated render/update loop
-   the package provisions a controlled browser runtime and page/session
    lifecycle around that workload
-   metrics may come from portable browser surfaces first, with deeper
    engine-specific adapters layered where needed
-   artifacts may include traces, screenshots, filmstrips, performance-event
    timelines, and raw metric dumps attached to the benchmark result
-   policies remain expressed through the shared benchmark model: explicit
    budgets for paint timing, interaction latency, jank, bundle weight, or
    other measured dimensions

This keeps browser benchmarking inside one benchmark family while still
giving it a real package boundary and room for browser-specific mechanics.

The benchmark layer should therefore be **backend-agnostic** at the concept
level:

-   BiDi-first where portable browser automation and event streams are enough
-   CDP where richer Chromium-specific performance metrics or tracing are
    required
-   Lighthouse-style adapters where page-flow auditing is the better fit

The important conceptual point is that these are still **performance and
resource-consumption** benchmarks. They belong in the benchmark family.

Relevant platform/tooling influences:

-   WebDriver BiDi
-   Chrome DevTools Protocol performance metrics
-   Chrome DevTools performance analysis workflows
-   Lighthouse user-flow / timespan style page-performance measurement

Sources:

-   <https://www.w3.org/TR/webdriver-bidi/>
-   <https://chromedevtools.github.io/devtools-protocol/tot/Performance/>
-   <https://developer.chrome.com/docs/devtools/performance/overview>

## Baselines

Performance baselines are snapshot-like in workflow but stricter in meaning.

Useful stored data may include:

-   machine metadata
-   workload identity
-   median and percentile thresholds
-   calibration context
-   exact metadata expectations
-   range-based budget semantics
-   benchmark shape (`cold-start`, `steady-state`, `external-process`, etc.)
-   measurement backend identity
-   browser/runtime metadata for frontend benchmarks
-   bundle-size budget metadata

## Reporting

Benchmark reports should be:

-   readable in CI
-   machine-readable for automation
-   specific about the failing benchmark, workload, metric, and threshold
-   explicit about whether results are raw, normalized, or not comparable
-   clear about warmup, sample count, and process model

## Strong External Influences

The strongest reusable benchmark concepts from other ecosystems are:

-   **Criterion.rs**
    -   benchmark groups
    -   parameterized inputs
    -   throughput annotations
    -   custom measurement backends
-   **JMH**
    -   forks, warmup, measurement iterations, and cold-start awareness
-   **BenchmarkDotNet**
    -   jobs as explicit execution profiles
    -   diagnosers
    -   multiple run strategies such as `Throughput` and `ColdStart`
-   **pytest-benchmark**
    -   compare mode
    -   pedantic/manual control mode
    -   benchmark-result JSON with machine metadata
-   **hyperfine**
    -   process benchmarking as a first-class use case
    -   setup / prepare / conclude / cleanup phases
    -   parameter scans
-   **Google Benchmark**
    -   counters and rates
    -   fixture benchmarks
    -   benchmark context metadata

Overkill should not copy all of these tools, but it should absorb their best
ideas into one coherent benchmark model.

## Influence

JMH provides the strongest reminder that a benchmark harness must actively help users avoid misleading results.

Source:

-   <https://github.com/openjdk/jmh>
